import crypto from 'crypto';
import mongoose from 'mongoose';
import { Task, type ITask } from '../models/Task';
import { Campaign } from '../models/Campaign';
import { SocialPost } from '../models/SocialPost';
import { UserRole, type IUser } from '../models/User';
import { deleteFromS3, objectKeyFromUrl } from '../utils/s3Service';
import { titleFrom } from '../lib/postTitle';

/**
 * Posts (Post v2, docs/POST_V2_PLAN.md): who a post belongs to, the one-time move away from themes,
 * and the storage rules for post pictures.
 */

type Id = mongoose.Types.ObjectId;

/** Earlier pictures kept per post (the current picture + these = 4). */
export const KEEP_EARLIER_PICTURES = 3;
/** Unpicked AI pictures are deleted after this many days. */
export const DRAFT_DAYS = 7;
/** At most this many unpicked AI pictures per post (the oldest go first). */
export const MAX_DRAFTS = 12;
/** At most this many reference pictures per post. */
export const MAX_REFERENCES = 6;

export const newId = () => crypto.randomBytes(8).toString('hex');

export class PostError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PostError';
  }
}

/** Admins see every post; everyone else only their own. */
export function canAccessPost(user: Pick<IUser, 'role' | '_id'>, task: Pick<ITask, 'ownerId'>): boolean {
  return user.role === UserRole.SYSTEM_ADMIN || String(task.ownerId) === String(user._id);
}

/** The post, if this person may use it (404 otherwise, so ids of other accounts aren't confirmed). */
export async function loadPostFor(user: Pick<IUser, 'role' | '_id'>, id: unknown): Promise<ITask> {
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) throw new PostError(400, 'Invalid post id');
  const task = await Task.findById(id);
  if (!task || !canAccessPost(user, task)) throw new PostError(404, 'Post not found');
  return task;
}

/**
 * Which campaign (if any) a post may be put in, and whose post it is. A campaign must belong to the
 * account; without a campaign an admin can say whose post it is (ownerId), else it's their own.
 */
export async function resolvePlacement(
  user: Pick<IUser, 'role' | '_id'>,
  input: { campaignId?: unknown; ownerId?: unknown },
  current?: { ownerId: Id }
): Promise<{ campaignId: Id | null; ownerId: Id }> {
  const admin = user.role === UserRole.SYSTEM_ADMIN;
  const wantsCampaign = input.campaignId !== undefined && input.campaignId !== null && input.campaignId !== '' && input.campaignId !== 'none';
  if (wantsCampaign) {
    if (typeof input.campaignId !== 'string' || !mongoose.isValidObjectId(input.campaignId)) throw new PostError(400, 'Invalid campaign id');
    const campaign = await Campaign.findById(input.campaignId).select('createdBy archived');
    if (!campaign) throw new PostError(404, 'Campaign not found');
    if (!admin && String(campaign.createdBy) !== String(user._id)) throw new PostError(403, 'You can only add posts to your own campaigns.');
    if (current && String(campaign.createdBy) !== String(current.ownerId)) throw new PostError(403, 'A post can only move to a campaign of the same account.');
    if (campaign.archived) throw new PostError(409, 'That campaign is archived. Restore it first.');
    return { campaignId: campaign._id as Id, ownerId: campaign.createdBy as Id };
  }
  if (current) return { campaignId: null, ownerId: current.ownerId };
  if (admin && typeof input.ownerId === 'string' && mongoose.isValidObjectId(input.ownerId)) {
    return { campaignId: null, ownerId: new mongoose.Types.ObjectId(input.ownerId) };
  }
  return { campaignId: null, ownerId: user._id as Id };
}

/** The title people see when they didn't type one. */
export function autoTitle(name: unknown, caption: unknown, brief: unknown): string {
  const typed = typeof name === 'string' ? name.trim() : '';
  return typed || titleFrom(typeof caption === 'string' ? caption : '', typeof brief === 'string' ? brief : '');
}

/**
 * One-time move to Post v2, run at start-up (safe to run again):
 * - every post gets its owner (the campaign's owner, else whoever created it)
 * - the theme's name is kept as legacyTheme
 * - reference images move from attachedImages to references
 */
export async function migratePostsToV2(): Promise<{ owners: number; themes: number; references: number }> {
  const result = { owners: 0, themes: 0, references: 0 };
  const posts = Task.collection;

  const missingOwner = await posts.find({ ownerId: { $exists: false } }, { projection: { campaignId: 1, createdBy: 1 } }).toArray();
  if (missingOwner.length) {
    const campaignIds = [...new Set(missingOwner.map((p) => String(p.campaignId || '')).filter(Boolean))];
    const campaigns = await Campaign.find({ _id: { $in: campaignIds } }).select('createdBy').lean();
    const ownerOf = new Map(campaigns.map((c) => [String(c._id), c.createdBy]));
    for (const p of missingOwner) {
      const owner = ownerOf.get(String(p.campaignId || '')) || p.createdBy;
      if (!owner) continue;
      await posts.updateOne({ _id: p._id }, { $set: { ownerId: owner } });
      result.owners++;
    }
  }

  const withTheme = await posts
    .find({ projectId: { $ne: null }, legacyTheme: { $exists: false } }, { projection: { projectId: 1 } })
    .toArray();
  if (withTheme.length) {
    const projects = await mongoose.connection
      .collection('projects')
      .find({ _id: { $in: [...new Set(withTheme.map((p) => String(p.projectId)))].map((x) => new mongoose.Types.ObjectId(x)) } }, { projection: { name: 1 } })
      .toArray();
    const nameOf = new Map(projects.map((p) => [String(p._id), String(p.name || '')]));
    for (const p of withTheme) {
      await posts.updateOne({ _id: p._id }, { $set: { legacyTheme: nameOf.get(String(p.projectId)) || '' } });
      result.themes++;
    }
  }

  const withAttached = await posts.find({ 'attachedImages.0': { $exists: true }, 'references.0': { $exists: false } }, { projection: { attachedImages: 1 } }).toArray();
  for (const p of withAttached) {
    const refs = (p.attachedImages as string[])
      .filter((u) => typeof u === 'string' && u)
      .slice(0, MAX_REFERENCES)
      .map((url) => ({ id: newId(), url, role: 'include', name: 'Reference picture', at: new Date() }));
    await posts.updateOne({ _id: p._id }, { $set: { references: refs } });
    result.references++;
  }

  if (result.owners || result.themes || result.references) {
    console.log(`[posts] Moved to Post v2: ${result.owners} owner(s) set, ${result.themes} theme name(s) kept, ${result.references} post(s) with reference pictures`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Storage: post pictures are deleted when nothing uses them any more
// ---------------------------------------------------------------------------

/** Whether a picture address is still used by any post or any scheduled/published copy. */
export async function pictureInUse(url: string): Promise<boolean> {
  const [post, copy] = await Promise.all([
    Task.exists({
      $or: [{ designedImage: url }, { 'imageHistory.url': url }, { 'aiDrafts.url': url }, { 'references.url': url }, { pendingGeneratedImage: url }]
    }),
    SocialPost.exists({ 'media.url': url })
  ]);
  return Boolean(post || copy);
}

/** Deletes stored pictures that nothing uses any more (only files in our own bucket). */
export async function deleteUnusedPictures(urls: (string | null | undefined)[]): Promise<number> {
  let deleted = 0;
  for (const url of new Set(urls.filter((u): u is string => typeof u === 'string' && u.length > 0))) {
    const key = objectKeyFromUrl(url);
    if (!key) continue; // not ours (or stored elsewhere): leave it alone
    try {
      if (await pictureInUse(url)) continue;
      await deleteFromS3(key);
      deleted++;
    } catch (error) {
      console.error('[posts] Could not delete an unused picture:', key, error);
    }
  }
  return deleted;
}

/**
 * Makes `url` the post's picture. The previous picture moves into the history (the 3 most recent
 * are kept, newest first); pictures that fall off the end are returned so the caller can delete
 * them once the post is saved.
 */
export function setPicture(task: ITask, url: string, previousNote?: string): string[] {
  const dropped: string[] = [];
  const previous = task.designedImage;
  if (previous === url) return dropped;
  const history = (task.imageHistory || []).filter((h) => h.url !== url && h.url !== previous);
  if (previous) history.unshift({ url: previous, source: 'earlier', note: previousNote, at: new Date() } as any);
  while (history.length > KEEP_EARLIER_PICTURES) dropped.push(history.pop()!.url);
  task.imageHistory = history as any;
  task.designedImage = url;
  return dropped;
}

/** Removes the post's picture (it becomes the newest earlier picture, so it can be brought back). */
export function clearPicture(task: ITask): string[] {
  const previous = task.designedImage;
  if (!previous) return [];
  const history = (task.imageHistory || []).filter((h) => h.url !== previous);
  history.unshift({ url: previous, source: 'earlier', note: 'Removed', at: new Date() } as any);
  const dropped: string[] = [];
  while (history.length > KEEP_EARLIER_PICTURES) dropped.push(history.pop()!.url);
  task.imageHistory = history as any;
  task.designedImage = undefined;
  return dropped;
}

/** Keeps the AI drafts list in order: newest first, at most MAX_DRAFTS; returns what fell off. */
export function addDraft(task: ITask, draft: ITask['aiDrafts'][number]): string[] {
  const drafts = [draft, ...(task.aiDrafts || [])];
  const dropped = drafts.slice(MAX_DRAFTS).map((d) => d.url);
  task.aiDrafts = drafts.slice(0, MAX_DRAFTS) as any;
  task.pendingGeneratedImage = task.aiDrafts[0]?.url;
  return dropped;
}

/** Removes a draft by id (or address); returns its address. */
export function removeDraft(task: ITask, idOrUrl: string): string | null {
  const found = (task.aiDrafts || []).find((d) => d.id === idOrUrl || d.url === idOrUrl);
  if (!found) return null;
  task.aiDrafts = (task.aiDrafts || []).filter((d) => d !== found) as any;
  task.pendingGeneratedImage = task.aiDrafts[0]?.url;
  return found.url;
}

/** Deletes AI drafts older than DRAFT_DAYS (run by the publishing worker every few minutes). */
export async function expireOldDrafts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DRAFT_DAYS * 86400000);
  const posts = await Task.find({ 'aiDrafts.at': { $lt: cutoff } }).limit(200);
  let removed = 0;
  for (const post of posts) {
    const old = (post.aiDrafts || []).filter((d) => new Date(d.at) < cutoff);
    if (!old.length) continue;
    post.aiDrafts = (post.aiDrafts || []).filter((d) => new Date(d.at) >= cutoff) as any;
    post.pendingGeneratedImage = post.aiDrafts[0]?.url;
    await post.save();
    await deleteUnusedPictures(old.map((d) => d.url));
    removed += old.length;
  }
  return removed;
}
