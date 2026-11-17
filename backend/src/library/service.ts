import fs from 'fs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { LibraryAsset, ILibraryAsset } from '../models/LibraryAsset';
import { LibraryVersion, ILibraryVersion } from '../models/LibraryVersion';
import { LibraryJob } from '../models/LibraryJob';
import { Campaign } from '../models/Campaign';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { IUser, UserRole } from '../models/User';
import { putPrivateObject, deleteFromS3 } from '../utils/s3Service';
import { resolveMime, kindOf, isZip, isRasterImage, titleFromFilename, folderOf, safeKeyName, extensionOf } from './files';
import { inspectImage, hammingDistance, sha256 } from './media';
import { extractText } from './text';
import { dateFromFilename, chooseCapturedAt } from './dates';
import { listZip, importableEntries, readZipEntry, ZipError } from './zip';
import { buildSearchText, reciprocalRankFusion, cosine, mergeTags, normalizeTag } from './search';
import { buildOverview, OverviewRow, LibraryOverview } from './overview';
import { searchRegex } from '../utils/regex';

/**
 * The Library (Aggregator) engine: ingest, versions, trash, review, search, overview and access.
 * Every query is scoped to one owner. Files live privately in S3 under library/<owner>/<version>/.
 */

export class LibraryError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

type Id = mongoose.Types.ObjectId;
const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));

export const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_PROCESS_BYTES = 60 * 1024 * 1024; // larger files are stored but not read into memory
const MAX_ZIP_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024;
const SIMILAR_IMAGE_DISTANCE = 10;
export const TRASH_DAYS = 30;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export function isAdmin(user: Pick<IUser, 'role'>): boolean {
  return user.role === UserRole.SYSTEM_ADMIN;
}

/** Whose library a request works on: your own, or (System Admins) any user's via ?ownerId=. */
export function resolveOwner(user: IUser, requested?: unknown): Id {
  if (requested && typeof requested === 'string' && mongoose.isValidObjectId(requested) && requested !== String(user._id)) {
    if (!isAdmin(user)) throw new LibraryError(403, 'You can only open your own library');
    return oid(requested);
  }
  return user._id as Id;
}

export async function loadAccessibleAsset(user: IUser, id: unknown, opts: { includeDeleted?: boolean } = {}): Promise<ILibraryAsset> {
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) throw new LibraryError(400, 'Invalid item id');
  const asset = await LibraryAsset.findById(id);
  if (!asset || (!opts.includeDeleted && asset.deletedAt)) throw new LibraryError(404, 'Item not found');
  if (String(asset.ownerId) !== String(user._id) && !isAdmin(user)) throw new LibraryError(404, 'Item not found');
  return asset;
}

/** Validate and complete links (a task implies its project and campaign). */
export async function resolveLinks(
  user: IUser,
  ownerId: Id,
  links: { campaignId?: unknown; projectId?: unknown; taskId?: unknown }
): Promise<{ campaignId: Id | null; projectId: Id | null; taskId: Id | null }> {
  const out: { campaignId: Id | null; projectId: Id | null; taskId: Id | null } = { campaignId: null, projectId: null, taskId: null };
  const valid = (v: unknown) => typeof v === 'string' && mongoose.isValidObjectId(v);
  if (valid(links.taskId)) {
    const task = await Task.findById(links.taskId).select('projectId campaignId');
    if (!task) throw new LibraryError(404, 'Task not found');
    out.taskId = task._id as Id;
    out.projectId = task.projectId;
    out.campaignId = task.campaignId;
  } else if (valid(links.projectId)) {
    const project = await Project.findById(links.projectId).select('campaignId');
    if (!project) throw new LibraryError(404, 'Project not found');
    out.projectId = project._id as Id;
    out.campaignId = project.campaignId;
  } else if (valid(links.campaignId)) {
    out.campaignId = oid(links.campaignId);
  }
  if (out.campaignId) {
    const campaign = await Campaign.findById(out.campaignId).select('createdBy');
    if (!campaign) throw new LibraryError(404, 'Campaign not found');
    if (!isAdmin(user) && String(campaign.createdBy) !== String(user._id)) {
      throw new LibraryError(403, 'You can only link items to your own campaigns, projects and tasks');
    }
    if (String(campaign.createdBy) !== String(ownerId) && !isAdmin(user)) {
      throw new LibraryError(403, 'That campaign belongs to someone else');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Caches (per owner): similar-image hashes and the overview
// ---------------------------------------------------------------------------

const hashCache = new Map<string, { at: number; entries: { assetId: string; dhash: string }[] }>();
const overviewCache = new Map<string, { at: number; value: unknown }>();

export function invalidateOwner(ownerId: Id | string) {
  overviewCache.delete(String(ownerId));
}

async function ownerHashes(ownerId: Id) {
  const key = String(ownerId);
  const cached = hashCache.get(key);
  if (cached && Date.now() - cached.at < 120_000) return cached.entries;
  const rows = await LibraryVersion.find({ ownerId, dhash: { $exists: true } }).select('assetId dhash').lean();
  const entries = rows.map((r) => ({ assetId: String(r.assetId), dhash: r.dhash as string }));
  hashCache.set(key, { at: Date.now(), entries });
  return entries;
}

async function findSimilarImage(ownerId: Id, dhash: string, excludeAssetId: string): Promise<{ assetId: Id; distance: number } | null> {
  const candidates = (await ownerHashes(ownerId))
    .filter((e) => e.assetId !== excludeAssetId)
    .map((e) => ({ assetId: e.assetId, distance: hammingDistance(dhash, e.dhash) }))
    .filter((e) => e.distance <= SIMILAR_IMAGE_DISTANCE)
    .sort((a, b) => a.distance - b.distance);
  for (const c of candidates.slice(0, 5)) {
    const alive = await LibraryAsset.exists({ _id: c.assetId, deletedAt: null });
    if (alive) return { assetId: oid(c.assetId), distance: c.distance };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function enqueueAnalyze(ownerId: Id, assetId: Id, delayMs = 0) {
  const existing = await LibraryJob.exists({ assetId, type: 'analyze', status: { $in: ['queued', 'running'] } });
  if (existing) return;
  await LibraryJob.create({ type: 'analyze', ownerId, assetId, runAfter: new Date(Date.now() + delayMs) });
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export interface IngestInput {
  ownerId: Id;
  userId: Id;
  originalName: string;
  relativePath?: string;
  mime?: string;
  data: { buffer: Buffer } | { path: string; size: number };
  lastModified?: Date | null;
  batchId?: string;
  source: string;
  links?: { campaignId: Id | null; projectId: Id | null; taskId: Id | null };
  targetAssetId?: Id;
  note?: string;
  event?: string;
  tags?: string[];
}

export interface IngestResult {
  name: string;
  status: 'created' | 'version_added' | 'duplicate' | 'failed';
  assetId?: string;
  versionNumber?: number;
  error?: string;
  similarTo?: string;
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

function sizeOf(data: IngestInput['data']): number {
  return 'buffer' in data ? data.buffer.length : data.size;
}

/** Ingest one upload. A .zip expands into many items (folder structure kept as a hint). */
export async function ingest(input: IngestInput): Promise<IngestResult[]> {
  const mime = resolveMime(input.originalName, input.mime);
  if (!input.targetAssetId && isZip(input.originalName, mime)) return ingestZip(input);
  try {
    return [await ingestOne({ ...input, mime })];
  } catch (error) {
    return [{ name: input.originalName, status: 'failed', error: error instanceof LibraryError || error instanceof ZipError ? error.message : 'Could not store this file' }];
  }
}

async function ingestZip(input: IngestInput): Promise<IngestResult[]> {
  const size = sizeOf(input.data);
  if (size > MAX_ZIP_BYTES) return [{ name: input.originalName, status: 'failed', error: 'Zip files can be up to 300 MB. Split it into smaller zips.' }];
  const buf = 'buffer' in input.data ? input.data.buffer : await fs.promises.readFile(input.data.path);
  let entries;
  try {
    entries = importableEntries(listZip(buf));
  } catch (error) {
    return [{ name: input.originalName, status: 'failed', error: error instanceof ZipError ? error.message : 'Could not open the zip file' }];
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    return [{ name: input.originalName, status: 'failed', error: `This zip has ${entries.length} files; the limit is ${MAX_ZIP_ENTRIES} per zip.` }];
  }
  const zipFolder = titleFromFilename(input.originalName);
  const results: IngestResult[] = [];
  let total = 0;
  for (const entry of entries) {
    const name = entry.name.split('/').pop() as string;
    try {
      total += entry.size;
      if (total > MAX_ZIP_TOTAL_BYTES) throw new LibraryError(413, 'The zip unpacks to more than 1 GB; split it into smaller zips.');
      const data = readZipEntry(buf, entry, MAX_ZIP_ENTRY_BYTES);
      results.push(
        await ingestOne({
          ...input,
          originalName: name,
          relativePath: `${zipFolder}/${entry.name}`,
          mime: resolveMime(name),
          data: { buffer: data },
          lastModified: null,
          source: 'zip'
        })
      );
    } catch (error) {
      results.push({ name: entry.name, status: 'failed', error: error instanceof Error ? error.message : 'Could not import' });
    }
  }
  return results;
}

async function ingestOne(input: IngestInput & { mime: string }): Promise<IngestResult> {
  const size = sizeOf(input.data);
  if (size === 0) throw new LibraryError(400, 'The file is empty');
  if (size > MAX_FILE_BYTES) throw new LibraryError(413, 'Files can be up to 200 MB');
  const name = input.originalName.slice(0, 300);
  const relativePath = input.relativePath || name;
  const mime = input.mime;
  const kind = kindOf(name, mime);
  const hash = 'buffer' in input.data ? sha256(input.data.buffer) : await hashFile(input.data.path);

  let target: ILibraryAsset | null = null;
  if (input.targetAssetId) {
    target = await LibraryAsset.findOne({ _id: input.targetAssetId, ownerId: input.ownerId, deletedAt: null });
    if (!target) throw new LibraryError(404, 'Item not found');
  }

  // Identical file already in this library?
  const dupVersion = await LibraryVersion.findOne({ ownerId: input.ownerId, sha256: hash }).sort({ createdAt: 1 });
  let reuse: ILibraryVersion | null = null;
  if (dupVersion) {
    const dupAsset = await LibraryAsset.findOne({ _id: dupVersion.assetId, deletedAt: null }).select('_id links');
    if (target && String(dupVersion.assetId) === String(target._id)) {
      throw new LibraryError(409, `This exact file is already version ${dupVersion.number} of this item`);
    }
    if (!target && dupAsset) {
      // Re-uploads are free: fill in a missing link (e.g. a task) and report the existing item.
      if (input.links?.taskId && !dupAsset.links?.taskId) {
        await LibraryAsset.updateOne({ _id: dupAsset._id }, { $set: { links: input.links } });
      }
      return { name, status: 'duplicate', assetId: String(dupAsset._id), versionNumber: dupVersion.number };
    }
    reuse = dupVersion; // same bytes stored already: reuse the stored objects
  }

  // Read into memory only what we can process (images, text, documents).
  let buffer: Buffer | null = 'buffer' in input.data ? input.data.buffer : null;
  const wantsProcessing = (kind === 'image' && isRasterImage(mime)) || kind === 'text' || ['docx', 'pptx'].includes(extensionOf(name));
  if (!buffer && wantsProcessing && size <= MAX_PROCESS_BYTES) buffer = await fs.promises.readFile((input.data as { path: string }).path);

  const now = new Date();
  const assetId: Id = target ? (target._id as Id) : new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();
  const base = `library/${input.ownerId}/${versionId}`;

  let s3Key = reuse?.s3Key;
  let thumbKey = reuse?.thumbKey;
  let aiKey = reuse?.aiKey;
  let width = reuse?.width;
  let height = reuse?.height;
  let dhash = reuse?.dhash;
  let exifDate: Date | null = null;
  const uploaded: string[] = [];

  try {
    if (!s3Key) {
      s3Key = `${base}/original.${safeKeyName(name)}`;
      if ('buffer' in input.data) await putPrivateObject(s3Key, input.data.buffer, mime, size);
      else await putPrivateObject(s3Key, fs.createReadStream(input.data.path), mime, size);
      uploaded.push(s3Key);

      if (buffer && kind === 'image' && isRasterImage(mime)) {
        const info = await inspectImage(buffer);
        if (info) {
          width = info.width;
          height = info.height;
          dhash = info.dhash;
          exifDate = info.exifDate;
          thumbKey = `${base}/thumb.webp`;
          aiKey = `${base}/ai.jpg`;
          await putPrivateObject(thumbKey, info.thumbnail, 'image/webp', info.thumbnail.length);
          uploaded.push(thumbKey);
          await putPrivateObject(aiKey, info.aiImage, 'image/jpeg', info.aiImage.length);
          uploaded.push(aiKey);
        }
      }
    }

    const extracted = buffer ? extractText(buffer, name, mime) : '';

    if (target) {
      const number = target.latestVersionNumber + 1;
      await LibraryVersion.create({
        _id: versionId,
        assetId,
        ownerId: input.ownerId,
        number,
        s3Key,
        thumbKey,
        aiKey,
        mime,
        size,
        width,
        height,
        sha256: hash,
        dhash,
        originalName: name,
        note: (input.note || '').slice(0, 1000),
        source: input.source,
        createdBy: input.userId
      });
      target.currentVersionId = versionId;
      target.versionCount += 1;
      target.latestVersionNumber = number;
      target.status = 'ready';
      target.aiStatus = 'pending';
      if (extracted) target.textContent = extracted;
      target.searchText = buildSearchText({ ...target.toObject(), originalName: name, links: [] });
      await target.save();
      if (dhash) hashCache.get(String(input.ownerId))?.entries.push({ assetId: String(assetId), dhash });
      await enqueueAnalyze(input.ownerId, assetId);
      invalidateOwner(input.ownerId);
      return { name, status: 'version_added', assetId: String(assetId), versionNumber: number };
    }

    const captured = chooseCapturedAt({
      exif: exifDate,
      filename: dateFromFilename(relativePath),
      fileModified: input.lastModified || null,
      uploadedAt: now
    });
    const title = titleFromFilename(name);
    const folder = folderOf(relativePath);
    const tags = mergeTags([input.tags || []], 20);
    const similar = dhash ? await findSimilarImage(input.ownerId, dhash, String(assetId)) : null;

    await LibraryAsset.create({
      _id: assetId,
      ownerId: input.ownerId,
      title,
      titleSource: 'filename',
      kind,
      category: kind === 'video' ? 'video' : kind === 'text' ? 'caption' : 'other',
      textContent: extracted,
      tags,
      event: (input.event || '').trim().slice(0, 120),
      folder,
      capturedAt: captured.date,
      dateSource: captured.source,
      links: input.links || { campaignId: null, projectId: null, taskId: null },
      currentVersionId: versionId,
      versionCount: 1,
      latestVersionNumber: 1,
      status: 'ready',
      aiStatus: 'pending',
      needsReview: Boolean(similar),
      review: similar ? { versionOf: similar } : null,
      searchText: buildSearchText({ title, textContent: extracted, tags, event: input.event, originalName: name, folder }),
      importBatchId: input.batchId,
      source: input.source,
      createdBy: input.userId
    });
    try {
      await LibraryVersion.create({
        _id: versionId,
        assetId,
        ownerId: input.ownerId,
        number: 1,
        s3Key,
        thumbKey,
        aiKey,
        mime,
        size,
        width,
        height,
        sha256: hash,
        dhash,
        originalName: name,
        note: (input.note || '').slice(0, 1000),
        source: input.source,
        createdBy: input.userId
      });
    } catch (error) {
      await LibraryAsset.deleteOne({ _id: assetId });
      throw error;
    }
    if (dhash) hashCache.get(String(input.ownerId))?.entries.push({ assetId: String(assetId), dhash });
    await enqueueAnalyze(input.ownerId, assetId);
    invalidateOwner(input.ownerId);
    return { name, status: 'created', assetId: String(assetId), versionNumber: 1, ...(similar ? { similarTo: String(similar.assetId) } : {}) };
  } catch (error) {
    // Don't leave orphaned files behind.
    await Promise.all(uploaded.map((k) => deleteFromS3(k).catch(() => undefined)));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Versions, trash, review
// ---------------------------------------------------------------------------

export async function listVersions(assetId: Id) {
  return LibraryVersion.find({ assetId }).sort({ number: -1 }).lean();
}

/** Make an older version current again by adding it as a new version (history is never rewritten). */
export async function restoreVersion(asset: ILibraryAsset, versionId: unknown, userId: Id) {
  if (typeof versionId !== 'string' || !mongoose.isValidObjectId(versionId)) throw new LibraryError(400, 'Invalid version id');
  const v = await LibraryVersion.findOne({ _id: versionId, assetId: asset._id });
  if (!v) throw new LibraryError(404, 'Version not found');
  if (asset.currentVersionId && String(asset.currentVersionId) === String(v._id)) throw new LibraryError(409, 'That version is already the current one');
  const number = asset.latestVersionNumber + 1;
  const created = await LibraryVersion.create({
    assetId: asset._id,
    ownerId: asset.ownerId,
    number,
    s3Key: v.s3Key,
    thumbKey: v.thumbKey,
    aiKey: v.aiKey,
    mime: v.mime,
    size: v.size,
    width: v.width,
    height: v.height,
    sha256: v.sha256,
    dhash: v.dhash,
    originalName: v.originalName,
    note: `Restored from version ${v.number}`,
    source: 'restore',
    restoredFrom: v.number,
    createdBy: userId
  });
  asset.currentVersionId = created._id as Id;
  asset.versionCount += 1;
  asset.latestVersionNumber = number;
  await asset.save();
  await enqueueAnalyze(asset.ownerId, asset._id as Id);
  invalidateOwner(asset.ownerId);
  return created;
}

export async function trashAsset(asset: ILibraryAsset) {
  asset.deletedAt = new Date();
  await asset.save();
  invalidateOwner(asset.ownerId);
}

export async function restoreAsset(asset: ILibraryAsset) {
  asset.deletedAt = null;
  await asset.save();
  invalidateOwner(asset.ownerId);
}

/** Permanently delete an item and any stored files no other version still uses. */
export async function purgeAsset(asset: ILibraryAsset) {
  const versions = await LibraryVersion.find({ assetId: asset._id });
  const keys = new Set<string>();
  versions.forEach((v) => [v.s3Key, v.thumbKey, v.aiKey].forEach((k) => k && keys.add(k)));
  await LibraryVersion.deleteMany({ assetId: asset._id });
  await LibraryAsset.deleteOne({ _id: asset._id });
  await LibraryJob.deleteMany({ assetId: asset._id, status: { $in: ['queued', 'failed'] } });
  for (const key of keys) {
    const stillUsed = await LibraryVersion.exists({ $or: [{ s3Key: key }, { thumbKey: key }, { aiKey: key }] });
    if (!stillUsed) await deleteFromS3(key).catch(() => undefined);
  }
  hashCache.delete(String(asset.ownerId));
  invalidateOwner(asset.ownerId);
}

export async function purgeExpiredTrash(): Promise<number> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000);
  const expired = await LibraryAsset.find({ deletedAt: { $ne: null, $lt: cutoff } }).limit(100);
  for (const a of expired) await purgeAsset(a);
  return expired.length;
}

/** Answer a "looks like a new version of …" suggestion. */
export async function resolveReview(asset: ILibraryAsset, action: unknown): Promise<{ assetId: string }> {
  if (action !== 'merge' && action !== 'keep') throw new LibraryError(400, 'action must be "merge" or "keep"');
  if (action === 'keep' || !asset.review?.versionOf?.assetId) {
    asset.needsReview = false;
    asset.review = null;
    await asset.save();
    invalidateOwner(asset.ownerId);
    return { assetId: String(asset._id) };
  }
  const target = await LibraryAsset.findOne({ _id: asset.review.versionOf.assetId, ownerId: asset.ownerId, deletedAt: null });
  if (!target) {
    asset.needsReview = false;
    asset.review = null;
    await asset.save();
    throw new LibraryError(404, 'The other item no longer exists, so this one was kept separate');
  }
  const versions = await LibraryVersion.find({ assetId: asset._id }).sort({ number: 1 });
  let number = target.latestVersionNumber;
  let last: Id | undefined;
  for (const v of versions) {
    number += 1;
    v.assetId = target._id as Id;
    v.number = number;
    v.source = 'merged';
    if (!v.note) v.note = `Added from “${asset.title}”`;
    await v.save();
    last = v._id as Id;
  }
  target.versionCount += versions.length;
  target.latestVersionNumber = number;
  if (last) target.currentVersionId = last;
  target.tags = mergeTags([target.tags || [], asset.tags || []], 30);
  if (!target.links?.taskId && asset.links?.taskId) target.links = asset.links;
  await target.save();
  await LibraryAsset.deleteOne({ _id: asset._id });
  await LibraryJob.deleteMany({ assetId: asset._id, status: 'queued' });
  hashCache.delete(String(asset.ownerId));
  await enqueueAnalyze(target.ownerId, target._id as Id);
  invalidateOwner(asset.ownerId);
  return { assetId: String(target._id) };
}

// ---------------------------------------------------------------------------
// Output shape (API / UI)
// ---------------------------------------------------------------------------

export function fileUrl(assetId: unknown, variant?: 'thumb' | 'download', versionId?: unknown) {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  if (versionId) params.set('version', String(versionId));
  const q = params.toString();
  return `/api/library/items/${assetId}/file${q ? `?${q}` : ''}`;
}

export function toItem(a: any, current?: any, opts: { detail?: boolean } = {}) {
  return {
    id: String(a._id),
    ownerId: String(a.ownerId),
    title: a.title,
    kind: a.kind,
    category: a.category,
    description: a.description,
    ...(opts.detail ? { textContent: a.textContent, notes: a.notes } : { textPreview: (a.textContent || '').slice(0, 280) }),
    tags: a.tags || [],
    event: a.event || '',
    colors: a.colors || [],
    folder: a.folder || '',
    capturedAt: a.capturedAt,
    dateSource: a.dateSource,
    links: {
      campaignId: a.links?.campaignId ? String(a.links.campaignId) : null,
      projectId: a.links?.projectId ? String(a.links.projectId) : null,
      taskId: a.links?.taskId ? String(a.links.taskId) : null
    },
    versionCount: a.versionCount,
    currentVersion: current
      ? {
          id: String(current._id),
          number: current.number,
          mime: current.mime,
          size: current.size,
          width: current.width,
          height: current.height,
          originalName: current.originalName,
          createdAt: current.createdAt,
          hasThumbnail: Boolean(current.thumbKey)
        }
      : null,
    status: a.status,
    aiStatus: a.aiStatus,
    aiError: a.aiError,
    needsReview: Boolean(a.needsReview),
    review: a.review?.versionOf ? { versionOf: { assetId: String(a.review.versionOf.assetId), distance: a.review.versionOf.distance } } : null,
    source: a.source,
    deletedAt: a.deletedAt || null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    thumbnailUrl: current && (current.thumbKey || (current.mime || '').startsWith('image/')) ? fileUrl(a._id, 'thumb') : null,
    fileUrl: fileUrl(a._id)
  };
}

async function withCurrent(assets: any[]) {
  const ids = assets.map((a) => a.currentVersionId).filter(Boolean);
  const versions = ids.length ? await LibraryVersion.find({ _id: { $in: ids } }).lean() : [];
  const map = new Map(versions.map((v) => [String(v._id), v]));
  return assets.map((a) => toItem(a, map.get(String(a.currentVersionId))));
}

// ---------------------------------------------------------------------------
// Search ("Google for one workspace") and overview ("table of contents")
// ---------------------------------------------------------------------------

export interface SearchParams {
  q?: string;
  kind?: string;
  category?: string;
  event?: string;
  tags?: string[];
  from?: Date | null;
  to?: Date | null;
  campaignId?: string;
  projectId?: string;
  taskId?: string;
  needsReview?: boolean;
  batchId?: string;
  trash?: boolean;
  sort?: 'newest' | 'oldest' | 'recent' | 'relevance';
  page?: number;
  limit?: number;
  queryEmbedding?: number[] | null;
}

function escapeExact(value: string): RegExp {
  return new RegExp(`^${value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

export function buildFilter(ownerId: Id, p: SearchParams): Record<string, unknown> {
  const filter: Record<string, unknown> = { ownerId, deletedAt: p.trash ? { $ne: null } : null };
  if (p.kind) filter.kind = p.kind;
  if (p.category) filter.category = p.category;
  if (p.event) filter.event = escapeExact(p.event);
  // Matches both the new spelling ("cold brew") and older saved ones ("cold_brew").
  if (p.tags?.length) filter.$and = p.tags.map(normalizeTag).filter(Boolean).map((t) => ({ tags: { $in: [t, t.replace(/ /g, '_'), t.replace(/ /g, '-')] } }));
  if (p.from || p.to) filter.capturedAt = { ...(p.from ? { $gte: p.from } : {}), ...(p.to ? { $lte: p.to } : {}) };
  if (p.campaignId && mongoose.isValidObjectId(p.campaignId)) filter['links.campaignId'] = oid(p.campaignId);
  if (p.projectId && mongoose.isValidObjectId(p.projectId)) filter['links.projectId'] = oid(p.projectId);
  if (p.taskId && mongoose.isValidObjectId(p.taskId)) filter['links.taskId'] = oid(p.taskId);
  if (p.needsReview) filter.needsReview = true;
  if (p.batchId) filter.importBatchId = p.batchId;
  return filter;
}

export async function searchLibrary(ownerId: Id, p: SearchParams) {
  const limit = Math.min(Math.max(p.limit || 30, 1), 100);
  const page = Math.max(p.page || 1, 1);
  const filter = buildFilter(ownerId, p);
  const q = (p.q || '').trim().slice(0, 200);

  if (!q) {
    const sort: Record<string, 1 | -1> =
      p.sort === 'oldest' ? { capturedAt: 1 } : p.sort === 'recent' ? { updatedAt: -1 } : p.trash ? { deletedAt: -1 } : { capturedAt: -1, _id: -1 };
    const [assets, total] = await Promise.all([
      LibraryAsset.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      LibraryAsset.countDocuments(filter)
    ]);
    return { items: await withCurrent(assets), total, page, limit };
  }

  // 1) Word index (ranked), 2) partial-word fallback, 3) meaning (embeddings) — merged by rank.
  const lists: string[][] = [];
  const textHits = await LibraryAsset.find({ ...filter, $text: { $search: q } }, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(300)
    .select('_id')
    .lean();
  lists.push(textHits.map((d) => String(d._id)));

  const pattern = searchRegex(q);
  if (pattern) {
    const partial = await LibraryAsset.find({ ...filter, $or: [{ title: pattern }, { searchText: pattern }] })
      .sort({ capturedAt: -1 })
      .limit(200)
      .select('_id')
      .lean();
    lists.push(partial.map((d) => String(d._id)));
  }

  if (p.queryEmbedding?.length) {
    const candidates = await LibraryAsset.find({ ...filter, embedding: { $exists: true } })
      .sort({ capturedAt: -1 })
      .limit(5000)
      .select('_id embedding')
      .lean();
    const scored = candidates
      .map((c: any) => ({ id: String(c._id), score: cosine(p.queryEmbedding!, c.embedding || []) }))
      .filter((s) => s.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);
    lists.push(scored.map((s) => s.id));
  }

  const ranked = reciprocalRankFusion(lists.filter((l) => l.length));
  const pageIds = ranked.slice((page - 1) * limit, page * limit);
  const docs = pageIds.length ? await LibraryAsset.find({ _id: { $in: pageIds } }).lean() : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const ordered = pageIds.map((id) => byId.get(id)).filter(Boolean);
  return { items: await withCurrent(ordered), total: ranked.length, page, limit };
}

export async function libraryOverview(ownerId: Id): Promise<LibraryOverview & { needsReview: number; processing: number; inTrash: number }> {
  const key = String(ownerId);
  const cached = overviewCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.value as any;

  const groups = await LibraryAsset.aggregate([
    { $match: { ownerId, deletedAt: null } },
    {
      $group: {
        _id: { y: { $year: '$capturedAt' }, m: { $month: '$capturedAt' }, kind: '$kind', event: '$event' },
        n: { $sum: 1 }
      }
    }
  ]);
  const rows = new Map<string, OverviewRow>();
  for (const g of groups) {
    const k = `${g._id.y}-${g._id.m}`;
    let row = rows.get(k);
    if (!row) {
      row = { year: g._id.y, month: g._id.m, count: 0, kinds: {}, events: {} };
      rows.set(k, row);
    }
    row.count += g.n;
    row.kinds[g._id.kind] = (row.kinds[g._id.kind] || 0) + g.n;
    if (g._id.event) row.events[g._id.event] = (row.events[g._id.event] || 0) + g.n;
  }
  const [needsReview, processing, inTrash] = await Promise.all([
    LibraryAsset.countDocuments({ ownerId, deletedAt: null, needsReview: true }),
    LibraryAsset.countDocuments({ ownerId, deletedAt: null, aiStatus: 'pending' }),
    LibraryAsset.countDocuments({ ownerId, deletedAt: { $ne: null } })
  ]);
  const value = { ...buildOverview([...rows.values()]), needsReview, processing, inTrash };
  overviewCache.set(key, { at: Date.now(), value });
  return value;
}

export async function batchProgress(ownerId: Id, batchId: string) {
  const [total, pending, failed, review] = await Promise.all([
    LibraryAsset.countDocuments({ ownerId, importBatchId: batchId }),
    LibraryAsset.countDocuments({ ownerId, importBatchId: batchId, aiStatus: 'pending' }),
    LibraryAsset.countDocuments({ ownerId, importBatchId: batchId, aiStatus: 'failed' }),
    LibraryAsset.countDocuments({ ownerId, importBatchId: batchId, needsReview: true })
  ]);
  return { batchId, total, processed: total - pending, pending, failed, needsReview: review, done: pending === 0 };
}

export async function aiUsedThisMonth(ownerId: Id): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return LibraryJob.countDocuments({ ownerId, aiUsed: true, finishedAt: { $gte: start } });
}

export function itemWithVersions(asset: ILibraryAsset, versions: any[]) {
  const current = versions.find((v) => String(v._id) === String(asset.currentVersionId));
  return {
    ...toItem(asset.toObject(), current, { detail: true }),
    versions: versions.map((v) => ({
      id: String(v._id),
      number: v.number,
      mime: v.mime,
      size: v.size,
      width: v.width,
      height: v.height,
      originalName: v.originalName,
      note: v.note,
      source: v.source,
      restoredFrom: v.restoredFrom,
      createdAt: v.createdAt,
      isCurrent: String(v._id) === String(asset.currentVersionId),
      thumbnailUrl: v.thumbKey || (v.mime || '').startsWith('image/') ? fileUrl(asset._id, 'thumb', v._id) : null,
      fileUrl: fileUrl(asset._id, undefined, v._id),
      downloadUrl: fileUrl(asset._id, 'download', v._id)
    }))
  };
}
