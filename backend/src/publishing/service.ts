import mongoose from 'mongoose';
import crypto from 'crypto';
import { Request } from 'express';
import { SocialChannel, ISocialChannel } from '../models/SocialChannel';
import { SocialPost, ISocialPost, PostMedia } from '../models/SocialPost';
import { PublishingConnect } from '../models/PublishingConnect';
import { Task } from '../models/Task';
import { Campaign } from '../models/Campaign';
import { User, UserRole, IUser, canUsePublishing } from '../models/User';
import { getPublicBaseUrl } from '../config/publicUrl';
import { PLATFORMS, PlatformId, ProviderId, PROVIDERS, AccountAuth, FetchLike, PublishError, PostOptions } from './types';
import { ADAPTERS, PLATFORM_PROVIDER, PLATFORM_NAMES, adapterFor } from './registry';
import { loadPublishingSetup } from './setup';
import { encryptSecret, decryptSecret, pkcePair } from './secrets';
import { validatePost, hasErrors, Problem } from './rules';
import { describeMedia, mediaDownloadUrl } from './media';

type Id = mongoose.Types.ObjectId;
const defaultFetch: FetchLike = (url, init) => fetch(url, init) as any;

export class PublishingError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export function isAdmin(user: IUser): boolean {
  return user.role === UserRole.SYSTEM_ADMIN;
}

/** Whose channels/posts: your own; System Admins may pass ownerId for support. */
export function resolveOwner(user: IUser, requested?: unknown): Id {
  if (requested && typeof requested === 'string' && isAdmin(user)) {
    if (!mongoose.isValidObjectId(requested)) throw new PublishingError(400, 'Invalid ownerId');
    return new mongoose.Types.ObjectId(requested);
  }
  return user._id as Id;
}

/** A task's posts go to the channels of the campaign's owner. */
export async function loadTaskForPublishing(user: IUser, taskId: unknown) {
  if (!mongoose.isValidObjectId(taskId)) throw new PublishingError(400, 'Invalid task id');
  const task = await Task.findById(taskId);
  if (!task) throw new PublishingError(404, 'Task not found');
  const campaign = await Campaign.findById(task.campaignId).select('createdBy name');
  if (!campaign) throw new PublishingError(404, 'Campaign not found');
  if (!isAdmin(user) && String(campaign.createdBy) !== String(user._id)) throw new PublishingError(403, 'You do not have access to this task');
  return { task, campaign, ownerId: campaign.createdBy as Id };
}

export async function loadPostForUser(user: IUser, id: unknown): Promise<ISocialPost> {
  if (!mongoose.isValidObjectId(id)) throw new PublishingError(400, 'Invalid post id');
  const post = await SocialPost.findById(id);
  if (!post || (!isAdmin(user) && String(post.ownerId) !== String(user._id))) throw new PublishingError(404, 'Post not found');
  return post;
}

export async function loadChannelForUser(user: IUser, id: unknown, withTokens = false): Promise<ISocialChannel> {
  if (!mongoose.isValidObjectId(id)) throw new PublishingError(400, 'Invalid channel id');
  const q = SocialChannel.findById(id);
  if (withTokens) q.select('+accessTokenEnc +refreshTokenEnc');
  const ch = await q;
  if (!ch || (!isAdmin(user) && String(ch.ownerId) !== String(user._id))) throw new PublishingError(404, 'Channel not found');
  return ch;
}

// ---------------------------------------------------------------------------
// Platforms & channels
// ---------------------------------------------------------------------------

export function callbackUrl(provider: ProviderId, req?: Request): string {
  return `${getPublicBaseUrl(req)}/api/publishing/oauth/${provider}/callback`;
}

export async function platformStatus() {
  const setup = await loadPublishingSetup();
  return PLATFORMS.map((p) => {
    const provider = PLATFORM_PROVIDER[p];
    return { id: p, name: PLATFORM_NAMES[p], provider, ready: setup.providers[provider].ready, approvalNote: ADAPTERS[provider].approvalNote };
  });
}

export function shapeChannel(c: ISocialChannel) {
  return {
    id: String(c._id),
    platform: c.platform,
    platformName: PLATFORM_NAMES[c.platform],
    name: c.name,
    username: c.username || null,
    avatarUrl: c.avatarUrl || null,
    accountType: c.accountType,
    simulated: c.simulated,
    status: c.status,
    lastError: c.lastError || null,
    expiresAt: c.expiresAt || null,
    lastUsedAt: c.lastUsedAt || null,
    createdAt: c.createdAt
  };
}

export async function listChannels(ownerId: Id) {
  const channels = await SocialChannel.find({ ownerId }).sort({ platform: 1, name: 1 });
  return channels.map(shapeChannel);
}

/** Step 1 of connecting: returns the platform's sign-in page URL. */
export async function startConnect(user: IUser, ownerId: Id, provider: string, req: Request, returnTo?: string): Promise<string> {
  if (!PROVIDERS.includes(provider as ProviderId)) throw new PublishingError(400, 'Unknown platform');
  const setup = await loadPublishingSetup();
  const s = setup.providers[provider as ProviderId];
  if (!s.ready) throw new PublishingError(409, `${ADAPTERS[provider as ProviderId].name} isn't switched on yet. A System Admin adds its app keys in Settings → Publishing.`);
  const { verifier, challenge } = pkcePair();
  const state = crypto.randomBytes(24).toString('base64url');
  await PublishingConnect.create({ state, userId: user._id, ownerId, provider, codeVerifier: verifier, returnTo });
  return ADAPTERS[provider as ProviderId].buildAuthorizeUrl({ settings: s, redirectUri: callbackUrl(provider as ProviderId, req), state, codeChallenge: challenge });
}

/** Step 2: the platform sends the user back; save every account the sign-in can post to. */
export async function finishConnect(provider: string, code: string, state: string, req: Request, fetchImpl: FetchLike = defaultFetch) {
  if (!PROVIDERS.includes(provider as ProviderId)) throw new PublishingError(400, 'Unknown platform');
  const pending = await PublishingConnect.findOneAndDelete({ state, provider });
  if (!pending) throw new PublishingError(400, 'This sign-in link expired. Please try connecting again.');
  const user = await User.findById(pending.userId).select('isActive publishingEnabled role');
  if (!user || !canUsePublishing(user)) throw new PublishingError(403, 'Publishing is not available for this account');
  const setup = await loadPublishingSetup();
  const s = setup.providers[provider as ProviderId];
  if (!s?.ready) throw new PublishingError(409, 'This platform was switched off while you were signing in');
  const adapter = ADAPTERS[provider as ProviderId];
  const tokens = await adapter.exchangeCode({ settings: s, redirectUri: callbackUrl(provider as ProviderId, req), code, codeVerifier: pending.codeVerifier, fetchImpl });
  if (!tokens.accessToken) throw new PublishingError(502, `${adapter.name} did not return a sign-in token`);
  const accounts = await adapter.discoverAccounts({ settings: s, tokens, fetchImpl });
  const saved: string[] = [];
  for (const a of accounts) {
    if (!a.accountId) continue;
    await SocialChannel.findOneAndUpdate(
      { ownerId: pending.ownerId, platform: a.platform, accountId: a.accountId, simulated: false },
      {
        $set: {
          accountType: a.accountType,
          name: a.name.slice(0, 200),
          username: a.username,
          avatarUrl: a.avatarUrl,
          accessTokenEnc: encryptSecret(a.accessToken),
          refreshTokenEnc: a.refreshToken ? encryptSecret(a.refreshToken) : undefined,
          expiresAt: a.expiresAt || null,
          scopes: a.scopes || tokens.scopes || [],
          meta: a.meta || {},
          status: 'active',
          lastError: undefined,
          connectedBy: pending.userId
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    saved.push(`${PLATFORM_NAMES[a.platform]}: ${a.name}`);
  }
  return { ownerId: pending.ownerId, saved, returnTo: pending.returnTo };
}

export async function addTestChannel(user: IUser, ownerId: Id, platform: string) {
  const setup = await loadPublishingSetup();
  if (!setup.testMode) throw new PublishingError(409, 'Test mode is switched off');
  if (!PLATFORMS.includes(platform as PlatformId)) throw new PublishingError(400, 'Unknown platform');
  const ch = await SocialChannel.findOneAndUpdate(
    { ownerId, platform, accountId: 'test', simulated: true },
    { $set: { name: `Test ${PLATFORM_NAMES[platform as PlatformId]} account`, username: 'test', accountType: 'person', status: 'active', connectedBy: user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return shapeChannel(ch);
}

export async function removeChannel(channel: ISocialChannel, userId: Id) {
  // Scheduled automatic posts to this channel can no longer go out: cancel them visibly.
  await SocialPost.updateMany(
    { channelId: channel._id, status: { $in: ['scheduled', 'draft'] }, mode: 'auto' },
    { $set: { status: 'cancelled', lastError: 'The account was disconnected' }, $push: { events: { at: new Date(), type: 'cancelled', message: 'Account disconnected', by: userId } } }
  );
  await channel.deleteOne();
}

/** Decrypted tokens, refreshed first if they are about to expire. */
export async function accountAuth(channel: ISocialChannel, fetchImpl: FetchLike = defaultFetch): Promise<AccountAuth> {
  const full = channel.accessTokenEnc === undefined ? await SocialChannel.findById(channel._id).select('+accessTokenEnc +refreshTokenEnc') : channel;
  if (!full) throw new PublishError('The account was disconnected', { reconnect: true });
  const auth: AccountAuth = {
    accessToken: decryptSecret(full.accessTokenEnc),
    refreshToken: full.refreshTokenEnc ? decryptSecret(full.refreshTokenEnc) : undefined,
    expiresAt: full.expiresAt,
    accountId: full.accountId,
    username: full.username,
    meta: full.meta || {}
  };
  const soon = Date.now() + 5 * 60_000;
  if (auth.expiresAt && auth.expiresAt.getTime() < soon) {
    const provider = PLATFORM_PROVIDER[full.platform];
    const setup = await loadPublishingSetup();
    const adapter = ADAPTERS[provider];
    const fresh = adapter.refresh ? await adapter.refresh({ settings: setup.providers[provider], account: auth, fetchImpl }) : null;
    if (!fresh) {
      if (auth.expiresAt.getTime() < Date.now()) throw new PublishError(`The ${PLATFORM_NAMES[full.platform]} sign-in expired; reconnect the account`, { reconnect: true });
    } else {
      auth.accessToken = fresh.accessToken;
      auth.refreshToken = fresh.refreshToken || auth.refreshToken;
      auth.expiresAt = fresh.expiresAt || null;
      // Some platforms (X) issue a new refresh token each time; save it straight away.
      await SocialChannel.updateOne(
        { _id: full._id },
        {
          $set: {
            accessTokenEnc: encryptSecret(fresh.accessToken),
            ...(fresh.refreshToken ? { refreshTokenEnc: encryptSecret(fresh.refreshToken) } : {}),
            expiresAt: fresh.expiresAt || null
          }
        }
      );
    }
  }
  return auth;
}

/** Live per-account choices the post form needs (TikTok creator settings). */
export async function channelOptions(channel: ISocialChannel, fetchImpl: FetchLike = defaultFetch) {
  if (channel.simulated) {
    return channel.platform === 'tiktok'
      ? { creatorName: channel.name, creatorUsername: 'test', privacyOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxVideoSeconds: 600 }
      : {};
  }
  const adapter = adapterFor(channel.platform);
  if (!adapter.accountOptions) return {};
  const setup = await loadPublishingSetup();
  const auth = await accountAuth(channel, fetchImpl);
  return adapter.accountOptions(channel.platform, { account: auth, settings: setup.providers[PLATFORM_PROVIDER[channel.platform]], fetchImpl });
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface MediaRef {
  source: 'url' | 'library';
  url?: string;
  assetId?: string;
  versionId?: string;
}

export interface TargetRef {
  channelId?: string;
  /** Manual target: "remind me to post this to Instagram by hand". */
  platform?: string;
}

export interface CreatePostsInput {
  taskId?: string;
  text: string;
  media: MediaRef[];
  targets: TargetRef[];
  when: 'now' | 'schedule' | 'draft';
  scheduledAt?: string;
  /** Per-platform options, e.g. { youtube: { title, privacy }, tiktok: { privacy, disableComments, … } }. */
  options?: Partial<Record<PlatformId, PostOptions>>;
}

interface ResolvedTarget {
  key: string;
  label: string;
  platform: PlatformId;
  mode: 'auto' | 'manual';
  channel?: ISocialChannel;
}

async function resolveTargets(ownerId: Id, targets: TargetRef[]): Promise<ResolvedTarget[]> {
  if (!Array.isArray(targets) || !targets.length) throw new PublishingError(400, 'Choose at least one place to post');
  if (targets.length > 20) throw new PublishingError(400, 'Too many destinations at once');
  const setup = await loadPublishingSetup();
  const out: ResolvedTarget[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    if (t.channelId) {
      if (!mongoose.isValidObjectId(t.channelId)) throw new PublishingError(400, 'Invalid channel');
      const ch = await SocialChannel.findOne({ _id: t.channelId, ownerId });
      if (!ch) throw new PublishingError(404, 'One of the chosen accounts is not connected any more');
      if (ch.status !== 'active') throw new PublishingError(409, `Reconnect ${PLATFORM_NAMES[ch.platform]} · ${ch.name} first`);
      if (!ch.simulated && !setup.providers[PLATFORM_PROVIDER[ch.platform]].ready) {
        throw new PublishingError(409, `${PLATFORM_NAMES[ch.platform]} publishing is switched off by your administrator`);
      }
      if (ch.simulated && !setup.testMode) throw new PublishingError(409, 'Test channels are switched off');
      const key = `c:${ch._id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: `${PLATFORM_NAMES[ch.platform]} · ${ch.name}`, platform: ch.platform, mode: 'auto', channel: ch });
    } else if (t.platform && PLATFORMS.includes(t.platform as PlatformId)) {
      const key = `m:${t.platform}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: `${PLATFORM_NAMES[t.platform as PlatformId]} (post by hand)`, platform: t.platform as PlatformId, mode: 'manual' });
    } else {
      throw new PublishingError(400, 'Unknown destination');
    }
  }
  return out;
}

async function resolveMedia(ownerId: Id, refs: MediaRef[]): Promise<PostMedia[]> {
  if (!Array.isArray(refs)) return [];
  if (refs.length > 20) throw new PublishingError(400, 'Up to 20 files per post');
  const out: PostMedia[] = [];
  for (const r of refs) {
    try {
      out.push(await describeMedia(ownerId, r as any));
    } catch (e: any) {
      throw new PublishingError(400, e?.message || 'Could not read one of the files');
    }
  }
  return out;
}

/** Validation per destination, as shown in the publish dialog. */
export async function checkPosts(ownerId: Id, input: Pick<CreatePostsInput, 'text' | 'media' | 'targets' | 'options'>) {
  const targets = await resolveTargets(ownerId, input.targets);
  const media = await resolveMedia(ownerId, input.media);
  const results = targets.map((t) => {
    const problems: Problem[] = validatePost(t.platform, { text: input.text || '', media: media as any, title: input.options?.[t.platform]?.title });
    if (t.mode === 'auto' && t.platform === 'tiktok' && !input.options?.tiktok?.privacy) problems.push({ level: 'error', message: 'Choose who can see the TikTok post.' });
    if (t.mode === 'auto' && t.channel?.simulated) problems.push({ level: 'warning', message: 'Test channel: nothing is really posted.' });
    return { key: t.key, label: t.label, platform: t.platform, mode: t.mode, problems };
  });
  return { targets: results, media, ok: results.every((r) => !hasErrors(r.problems)) };
}

export async function createPosts(user: IUser, ownerId: Id, input: CreatePostsInput, extra: { taskId?: Id; campaignId?: Id } = {}) {
  const text = typeof input.text === 'string' ? input.text : '';
  const check = await checkPosts(ownerId, input);
  if (input.when !== 'draft' && !check.ok) throw new PublishingError(400, 'Fix the problems before scheduling', check.targets);
  let scheduledAt = new Date();
  if (input.when === 'schedule') {
    const d = new Date(String(input.scheduledAt || ''));
    if (Number.isNaN(d.getTime())) throw new PublishingError(400, 'Choose a date and time');
    if (d.getTime() < Date.now() - 60_000) throw new PublishingError(400, 'That time is in the past');
    if (d.getTime() > Date.now() + 366 * 86400_000) throw new PublishingError(400, 'Posts can be scheduled up to a year ahead');
    scheduledAt = d;
  }
  const targets = await resolveTargets(ownerId, input.targets);
  const groupId = `g${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
  const status = input.when === 'draft' ? 'draft' : 'scheduled';
  const posts = await SocialPost.insertMany(
    targets.map((t) => ({
      ownerId,
      groupId,
      taskId: extra.taskId,
      campaignId: extra.campaignId,
      channelId: t.channel?._id,
      platform: t.platform,
      mode: t.mode,
      text,
      media: check.media,
      options: cleanOptions(input.options?.[t.platform]),
      status,
      scheduledAt: input.when === 'draft' ? undefined : scheduledAt,
      nextAttemptAt: input.when === 'draft' ? undefined : scheduledAt,
      events: [{ at: new Date(), type: status, message: input.when === 'now' ? 'Post now' : undefined, by: user._id }],
      createdBy: user._id
    }))
  );
  return posts;
}

function cleanOptions(o?: PostOptions): Record<string, unknown> {
  if (!o) return {};
  const out: Record<string, unknown> = {};
  if (typeof o.title === 'string') out.title = o.title.slice(0, 200);
  if (typeof o.privacy === 'string') out.privacy = o.privacy.slice(0, 40);
  for (const k of ['disableComments', 'disableDuet', 'disableStitch', 'brandOrganic', 'brandedContent', 'madeForKids'] as const) {
    if (typeof o[k] === 'boolean') out[k] = o[k];
  }
  return out;
}

export async function updatePost(user: IUser, post: ISocialPost, body: { text?: string; scheduledAt?: string; options?: PostOptions; schedule?: boolean }) {
  if (!['draft', 'scheduled', 'failed', 'due'].includes(post.status)) throw new PublishingError(409, 'This post can no longer be changed');
  if (typeof body.text === 'string') post.text = body.text;
  if (body.options) post.options = cleanOptions(body.options);
  if (body.scheduledAt !== undefined || body.schedule) {
    const d = body.scheduledAt ? new Date(body.scheduledAt) : new Date();
    if (Number.isNaN(d.getTime())) throw new PublishingError(400, 'Choose a date and time');
    post.scheduledAt = d;
    post.nextAttemptAt = d;
    if (post.status === 'draft' || post.status === 'failed' || post.status === 'due' || body.schedule) post.status = 'scheduled';
  }
  if (post.status === 'scheduled') {
    const problems = validatePost(post.platform, { text: post.text, media: post.media as any, title: post.options?.title });
    if (hasErrors(problems)) throw new PublishingError(400, problems.filter((p) => p.level === 'error').map((p) => p.message).join(' '), problems);
  }
  post.events.push({ at: new Date(), type: 'edited', by: user._id as Id });
  post.markModified('options');
  await post.save();
  return post;
}

export async function cancelPost(user: IUser, post: ISocialPost) {
  if (!['draft', 'scheduled', 'failed', 'due'].includes(post.status)) throw new PublishingError(409, 'This post is already being published or was published');
  // Atomic so a post the scheduler just picked up isn't reported as cancelled.
  const updated = await SocialPost.findOneAndUpdate(
    { _id: post._id, status: post.status },
    { $set: { status: 'cancelled' }, $push: { events: { at: new Date(), type: 'cancelled', by: user._id } } },
    { new: true }
  );
  if (!updated) throw new PublishingError(409, 'The post changed in the meantime; refresh and try again');
  return updated;
}

export async function retryPost(user: IUser, post: ISocialPost) {
  if (post.status !== 'failed') throw new PublishingError(409, 'Only failed posts can be retried');
  if (post.mode === 'auto' && post.channelId) {
    const ch = await SocialChannel.findById(post.channelId);
    if (!ch) throw new PublishingError(409, 'The account was disconnected; post it to another account instead');
    if (ch.status !== 'active') throw new PublishingError(409, `Reconnect ${PLATFORM_NAMES[ch.platform]} · ${ch.name} first`);
  }
  post.status = 'scheduled';
  post.scheduledAt = new Date();
  post.nextAttemptAt = new Date();
  post.attempts = 0;
  post.lastError = undefined;
  post.events.push({ at: new Date(), type: 'retry', by: user._id as Id });
  await post.save();
  return post;
}

export async function markPublished(user: IUser, post: ISocialPost, url?: string) {
  if (['publishing', 'processing'].includes(post.status)) throw new PublishingError(409, 'This post is being published right now');
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new PublishingError(400, 'Paste the full link to the live post');
  post.status = 'published';
  post.publishedAt = post.publishedAt || new Date();
  if (url) post.remoteUrl = url.slice(0, 500);
  post.lastError = undefined;
  post.events.push({ at: new Date(), type: 'marked_published', message: url, by: user._id as Id });
  await post.save();
  return post;
}

export async function deletePost(post: ISocialPost) {
  if (['publishing', 'processing'].includes(post.status)) throw new PublishingError(409, 'Wait until publishing finishes');
  await post.deleteOne();
}

export async function postDownloadUrl(post: ISocialPost, index: number) {
  const m = post.media[index];
  if (!m) throw new PublishingError(404, 'File not found');
  return mediaDownloadUrl(post.ownerId as Id, m);
}

export interface PostQuery {
  status?: string;
  taskId?: string;
  campaignId?: string;
  platform?: string;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  limit?: number;
}

export async function listPosts(ownerId: Id, q: PostQuery) {
  const filter: Record<string, any> = { ownerId };
  if (q.status) {
    const groups: Record<string, string[]> = {
      upcoming: ['scheduled', 'publishing', 'processing'],
      attention: ['failed', 'due'],
      done: ['published']
    };
    filter.status = { $in: groups[q.status] || q.status.split(',') };
  }
  if (q.taskId && mongoose.isValidObjectId(q.taskId)) filter.taskId = q.taskId;
  if (q.campaignId && mongoose.isValidObjectId(q.campaignId)) filter.campaignId = q.campaignId;
  if (q.platform && PLATFORMS.includes(q.platform as PlatformId)) filter.platform = q.platform;
  if (q.from || q.to) {
    filter.scheduledAt = {};
    if (q.from) filter.scheduledAt.$gte = q.from;
    if (q.to) filter.scheduledAt.$lte = q.to;
  }
  const limit = Math.min(100, Math.max(1, q.limit || 50));
  const page = Math.max(1, q.page || 1);
  const upcoming = q.status === 'upcoming';
  const [posts, total] = await Promise.all([
    SocialPost.find(filter)
      .sort(upcoming ? { scheduledAt: 1 } : { scheduledAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('channelId', 'name username avatarUrl platform simulated status')
      .populate('taskId', 'name')
      .populate('campaignId', 'name'),
    SocialPost.countDocuments(filter)
  ]);
  return { posts: posts.map(shapePost), total, page, limit };
}

export async function countsFor(ownerId: Id) {
  const rows = await SocialPost.aggregate([{ $match: { ownerId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const by: Record<string, number> = {};
  for (const r of rows) by[r._id] = r.n;
  return {
    upcoming: (by.scheduled || 0) + (by.publishing || 0) + (by.processing || 0),
    attention: (by.failed || 0) + (by.due || 0),
    published: by.published || 0,
    drafts: by.draft || 0
  };
}

export function shapePost(p: ISocialPost) {
  const ch: any = p.channelId && typeof p.channelId === 'object' && 'name' in (p.channelId as any) ? p.channelId : null;
  const task: any = p.taskId && typeof p.taskId === 'object' && 'name' in (p.taskId as any) ? p.taskId : null;
  const campaign: any = p.campaignId && typeof p.campaignId === 'object' && 'name' in (p.campaignId as any) ? p.campaignId : null;
  return {
    id: String(p._id),
    groupId: p.groupId,
    platform: p.platform,
    platformName: PLATFORM_NAMES[p.platform],
    mode: p.mode,
    status: p.status,
    text: p.text,
    media: p.media.map((m, i) => ({ index: i, kind: m.kind, name: m.name, mime: m.mime, size: m.size, source: m.source, url: m.source === 'url' ? m.url : undefined, assetId: m.assetId ? String(m.assetId) : undefined })),
    options: p.options || {},
    scheduledAt: p.scheduledAt || null,
    publishedAt: p.publishedAt || null,
    remoteUrl: p.remoteUrl || null,
    progress: p.status === 'publishing' || p.status === 'processing' ? p.progress || null : null,
    lastError: p.lastError || null,
    attempts: p.attempts,
    channel: ch ? { id: String(ch._id), name: ch.name, username: ch.username, avatarUrl: ch.avatarUrl, simulated: ch.simulated, status: ch.status } : p.channelId ? { id: String(p.channelId) } : null,
    task: task ? { id: String(task._id), name: task.name } : p.taskId ? { id: String(p.taskId) } : null,
    campaign: campaign ? { id: String(campaign._id), name: campaign.name } : p.campaignId ? { id: String(p.campaignId) } : null,
    events: (p.events || []).slice(-20),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  };
}
