import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin, canCreateCampaign } from '../middleware/rbac';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { canUseLibrary } from '../models/User';
import { AppConfig } from '../models/AppConfig';
import { LibraryAsset } from '../models/LibraryAsset';
import { LibraryVersion } from '../models/LibraryVersion';
import { LibraryJob } from '../models/LibraryJob';
import { signedObjectUrl, getObjectBuffer, uploadBufferToS3 } from '../utils/s3Service';
import { loadTaskForPublishing, PublishingError } from '../publishing/service';
import { deleteUnusedPictures, setPicture } from '../services/posts';
import { getProviderKey } from '../services/llmService';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { loadLibrarySetup, invalidateLibrarySetup } from '../library/setup';
import { embedTexts } from '../library/vision';
import { parseDay } from '../library/dates';
import { buildSearchText, mergeTags } from '../library/search';
import { BLUE_PROVIDERS } from '../blue/setup';
import {
  LibraryError,
  MAX_FILE_BYTES,
  resolveOwner,
  loadAccessibleAsset,
  resolveLinks,
  ingest,
  listVersions,
  restoreVersion,
  trashAsset,
  restoreAsset,
  purgeAsset,
  resolveReview,
  searchLibrary,
  libraryOverview,
  batchProgress,
  aiUsedThisMonth,
  itemWithVersions,
  enqueueAnalyze,
  invalidateOwner,
  IngestResult
} from '../library/service';

/**
 * Library (Aggregator) API — everything is scoped to the signed-in user's library
 * (System Admins may pass ?ownerId= to open someone else's for support).
 */
const router = express.Router();
type Id = mongoose.Types.ObjectId;

// Uploads stream to a temp folder on disk (no 200 MB files held in memory), then to private S3.
const tmpDir = path.join(os.tmpdir(), 'blueprint-library-uploads');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`)
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 50 }
});

function cleanup(files: Express.Multer.File[] | undefined) {
  for (const f of files || []) fs.promises.unlink(f.path).catch(() => undefined);
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof LibraryError) return res.status(error.status).json({ success: false, message: error.message });
  console.error(`[library] ${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
}

/** Library access gate (global switch + per-user toggle). */
async function requireLibrary(req: Request, res: Response, next: NextFunction) {
  try {
    const setup = await loadLibrarySetup();
    if (!setup.enabled) return res.status(403).json({ success: false, code: 'LIBRARY_DISABLED', message: 'The Library is switched off for this workspace.' });
    if (!canUseLibrary(req.user!)) return res.status(403).json({ success: false, code: 'LIBRARY_DISABLED_FOR_USER', message: 'Your administrator has turned the Library off for your account.' });
    next();
  } catch (error) {
    next(error);
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const embeddingCache = new Map<string, { at: number; vector: number[] }>();
async function queryEmbedding(q: string): Promise<number[] | null> {
  const key = q.trim().toLowerCase();
  const hit = embeddingCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.vector;
  try {
    const [vector] = await embedTexts(await getProviderKey('openai'), [q]);
    if (!vector?.length) return null;
    if (embeddingCache.size > 500) embeddingCache.clear();
    embeddingCache.set(key, { at: Date.now(), vector });
    return vector;
  } catch {
    return null;
  }
}

function endOfDay(d: Date | null): Date | null {
  return d ? new Date(d.getTime() + 86400000 - 1) : null;
}

// ---------------------------------------------------------------------------
// Status & settings
// ---------------------------------------------------------------------------

router.get('/status', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const setup = await loadLibrarySetup();
    const ownerId = req.user!._id as Id;
    res.json({
      success: true,
      available: setup.enabled && canUseLibrary(req.user!),
      reason: !setup.enabled ? 'The Library is switched off for this workspace.' : !canUseLibrary(req.user!) ? 'Your administrator has turned the Library off for your account.' : undefined,
      ai: { enabled: Boolean(setup.provider), problem: setup.aiProblem || null, monthlyLimit: setup.monthlyAiLimit, usedThisMonth: await aiUsedThisMonth(ownerId) },
      semanticSearch: setup.semantic,
      maxFileBytes: MAX_FILE_BYTES
    });
  } catch (error) {
    fail(res, error, 'Could not load Library status');
  }
});

function settingsPayload(config: any, setup: Awaited<ReturnType<typeof loadLibrarySetup>>) {
  return {
    enabled: config.libraryEnabled !== false,
    provider: config.libraryProvider || null,
    model: config.libraryModel || '',
    monthlyAiLimit: setup.monthlyAiLimit,
    semanticSearch: config.librarySemanticSearch !== false,
    semanticAvailable: setup.configuredProviders.includes('openai'),
    effectiveProvider: setup.provider || null,
    effectiveModel: setup.model || null,
    problem: setup.aiProblem || null,
    configuredProviders: setup.configuredProviders
  };
}

router.get('/settings', isAuthenticated, isSystemAdmin, async (_req: Request, res: Response) => {
  try {
    invalidateLibrarySetup();
    res.json({ success: true, settings: settingsPayload(await AppConfig.getConfig(), await loadLibrarySetup()) });
  } catch (error) {
    fail(res, error, 'Could not load Library settings');
  }
});

router.patch('/settings', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { enabled, provider, model, monthlyAiLimit, semanticSearch } = req.body || {};
    const config = await AppConfig.getConfig();
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') throw new LibraryError(400, 'enabled must be true or false');
      config.libraryEnabled = enabled;
    }
    if (semanticSearch !== undefined) {
      if (typeof semanticSearch !== 'boolean') throw new LibraryError(400, 'semanticSearch must be true or false');
      config.librarySemanticSearch = semanticSearch;
    }
    if (provider !== undefined) {
      if (provider !== null && !BLUE_PROVIDERS.includes(provider)) throw new LibraryError(400, `provider must be one of: ${BLUE_PROVIDERS.join(', ')}`);
      config.libraryProvider = provider || undefined;
    }
    if (model !== undefined) {
      if (typeof model !== 'string' || model.length > 100) throw new LibraryError(400, 'model must be a model ID');
      config.libraryModel = model.trim() || undefined;
    }
    if (monthlyAiLimit !== undefined) {
      if (!Number.isInteger(monthlyAiLimit) || monthlyAiLimit < 0 || monthlyAiLimit > 1_000_000) throw new LibraryError(400, 'monthlyAiLimit must be a whole number (0 = unlimited)');
      config.libraryMonthlyAiLimit = monthlyAiLimit;
    }
    await config.save();
    invalidateLibrarySetup();
    res.json({ success: true, message: 'Library settings saved', settings: settingsPayload(config, await loadLibrarySetup()) });
  } catch (error) {
    fail(res, error, 'Could not save Library settings');
  }
});

// ---------------------------------------------------------------------------
// Browse & search
// ---------------------------------------------------------------------------

router.get('/overview', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const ownerId = resolveOwner(req.user!, req.query.ownerId);
    res.json({ success: true, overview: await libraryOverview(ownerId) });
  } catch (error) {
    fail(res, error, 'Could not load the Library overview');
  }
});

router.get('/items', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const ownerId = resolveOwner(req.user!, q.ownerId);
    const setup = await loadLibrarySetup();
    const text = (q.q || '').trim();
    const result = await searchLibrary(ownerId, {
      q: text,
      kind: q.kind,
      category: q.category,
      event: q.event,
      tags: q.tags ? q.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      from: parseDay(q.from),
      to: endOfDay(parseDay(q.to)),
      campaignId: q.campaignId,
      projectId: q.projectId,
      taskId: q.taskId,
      needsReview: q.needsReview === 'true',
      batchId: q.batchId,
      trash: q.trash === 'true',
      sort: q.sort as any,
      page: Number(q.page) || 1,
      limit: Number(q.limit) || 30,
      queryEmbedding: text && setup.semantic ? await queryEmbedding(text) : null
    });
    res.json({ success: true, ...result });
  } catch (error) {
    fail(res, error, 'Could not search the Library');
  }
});

router.get('/items/:id', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id, { includeDeleted: true });
    res.json({ success: true, item: itemWithVersions(asset, await listVersions(asset._id as Id)) });
  } catch (error) {
    fail(res, error, 'Could not load this item');
  }
});

/** Serves a file through a short-lived signed link (redirect), so files are never public. */
router.get('/items/:id/file', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id, { includeDeleted: true });
    const versionId = typeof req.query.version === 'string' && mongoose.isValidObjectId(req.query.version) ? req.query.version : asset.currentVersionId;
    const version = await LibraryVersion.findOne({ _id: versionId, assetId: asset._id });
    if (!version) throw new LibraryError(404, 'File not found');
    const variant = req.query.variant;
    let url: string;
    if (variant === 'thumb') {
      if (version.thumbKey) url = await signedObjectUrl(version.thumbKey, { contentType: 'image/webp' });
      else if (version.mime.startsWith('image/')) url = await signedObjectUrl(version.s3Key, { contentType: version.mime });
      else throw new LibraryError(404, 'No preview for this file');
    } else if (variant === 'download') {
      url = await signedObjectUrl(version.s3Key, { downloadName: version.originalName });
    } else {
      url = await signedObjectUrl(version.s3Key, { contentType: version.mime });
    }
    res.set('Cache-Control', 'private, max-age=1800');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin'); // the app may run on another address than the API (e.g. localhost:3000 vs :5000); without this, browsers refuse to show the image
    res.redirect(302, url);
  } catch (error) {
    fail(res, error, 'Could not open this file');
  }
});

// ---------------------------------------------------------------------------
// Upload & import
// ---------------------------------------------------------------------------

router.post('/uploads', isAuthenticated, requireLibrary, upload.array('files', 50), async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  try {
    if (!files.length) throw new LibraryError(400, 'Choose at least one file');
    const ownerId = resolveOwner(req.user!, req.body.ownerId);
    const paths = parseJsonArray(req.body.relativePaths);
    const modified = parseJsonArray(req.body.lastModified);
    const batchId = typeof req.body.batchId === 'string' && /^[\w-]{6,64}$/.test(req.body.batchId) ? req.body.batchId : `b${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    const links = req.body.taskId || req.body.projectId || req.body.campaignId
      ? await resolveLinks(req.user!, ownerId, { taskId: req.body.taskId, projectId: req.body.projectId, campaignId: req.body.campaignId })
      : undefined;
    const tags = typeof req.body.tags === 'string' ? req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

    const results: IngestResult[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // multer decodes names as latin1; browsers send UTF-8
      const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const rel = typeof paths[i] === 'string' && (paths[i] as string).length < 500 ? (paths[i] as string) : originalName;
      const lm = typeof modified[i] === 'number' ? new Date(modified[i] as number) : null;
      results.push(
        ...(await ingest({
          ownerId,
          userId: req.user!._id as Id,
          originalName,
          relativePath: rel,
          mime: f.mimetype,
          data: { path: f.path, size: f.size },
          lastModified: lm && !Number.isNaN(lm.getTime()) ? lm : null,
          batchId,
          source: 'upload',
          links,
          event: typeof req.body.event === 'string' ? req.body.event : undefined,
          tags
        }))
      );
    }
    const created = results.filter((r) => r.status === 'created').length;
    if (created) {
      await logAudit({ action: AuditAction.LIBRARY_UPLOADED, userId: req.user!._id as Id, targetType: 'User', targetId: ownerId, metadata: { batchId, created, files: results.length }, req });
    }
    res.status(201).json({ success: true, batchId, results });
  } catch (error) {
    fail(res, error, 'Upload failed');
  } finally {
    cleanup(files);
  }
});

router.get('/imports/:batchId', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const ownerId = resolveOwner(req.user!, req.query.ownerId);
    res.json({ success: true, progress: await batchProgress(ownerId, String(req.params.batchId).slice(0, 64)) });
  } catch (error) {
    fail(res, error, 'Could not load import progress');
  }
});

router.post('/import-app', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const ownerId = resolveOwner(req.user!, req.body?.ownerId);
    const running = await LibraryJob.exists({ ownerId, type: 'import_app', status: { $in: ['queued', 'running'] } });
    if (running) throw new LibraryError(409, 'An import of your app files is already running');
    const batchId = `app${Date.now().toString(36)}`;
    await LibraryJob.create({ type: 'import_app', ownerId, payload: { batchId } });
    res.status(202).json({ success: true, batchId, message: 'Importing your existing post images, logos and files. They will appear in a few minutes.' });
  } catch (error) {
    fail(res, error, 'Could not start the import');
  }
});

// ---------------------------------------------------------------------------
// One item: edit, versions, review, trash
// ---------------------------------------------------------------------------

router.patch('/items/:id', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id);
    const b = req.body || {};
    if (b.title !== undefined) {
      if (typeof b.title !== 'string' || !b.title.trim()) throw new LibraryError(400, 'Title cannot be empty');
      asset.title = b.title.trim().slice(0, 200);
      asset.titleSource = 'user';
    }
    if (b.description !== undefined) asset.description = String(b.description || '').slice(0, 2000);
    if (b.notes !== undefined) asset.notes = String(b.notes || '').slice(0, 5000);
    if (b.event !== undefined) asset.event = String(b.event || '').trim().slice(0, 120);
    if (b.category !== undefined) asset.category = String(b.category || 'other').slice(0, 40);
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags)) throw new LibraryError(400, 'tags must be a list');
      asset.tags = mergeTags([b.tags], 30);
    }
    if (b.capturedAt !== undefined) {
      const d = parseDay(b.capturedAt);
      if (!d) throw new LibraryError(400, 'Date must be YYYY-MM-DD');
      asset.capturedAt = d;
      asset.dateSource = 'user';
    }
    if (b.links !== undefined) {
      asset.links = await resolveLinks(req.user!, asset.ownerId as Id, b.links || {});
    }
    const current = await LibraryVersion.findById(asset.currentVersionId).select('originalName');
    asset.searchText = buildSearchText({ ...asset.toObject(), originalName: current?.originalName, links: [] });
    await asset.save();
    invalidateOwner(asset.ownerId);
    res.json({ success: true, item: itemWithVersions(asset, await listVersions(asset._id as Id)) });
  } catch (error) {
    fail(res, error, 'Could not save changes');
  }
});

router.post('/items/:id/versions', isAuthenticated, requireLibrary, upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  try {
    if (!file) throw new LibraryError(400, 'Choose a file');
    const asset = await loadAccessibleAsset(req.user!, req.params.id);
    const [result] = await ingest({
      ownerId: asset.ownerId as Id,
      userId: req.user!._id as Id,
      originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      mime: file.mimetype,
      data: { path: file.path, size: file.size },
      source: 'upload',
      targetAssetId: asset._id as Id,
      note: typeof req.body.note === 'string' ? req.body.note : ''
    });
    if (result.status === 'failed') throw new LibraryError(/already version/.test(result.error || '') ? 409 : 400, result.error || 'Upload failed');
    const fresh = await loadAccessibleAsset(req.user!, req.params.id);
    res.status(201).json({ success: true, item: itemWithVersions(fresh, await listVersions(fresh._id as Id)) });
  } catch (error) {
    fail(res, error, 'Could not add the version');
  } finally {
    cleanup(file ? [file] : []);
  }
});

router.post('/items/:id/versions/:versionId/restore', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id);
    await restoreVersion(asset, req.params.versionId, req.user!._id as Id);
    res.json({ success: true, item: itemWithVersions(asset, await listVersions(asset._id as Id)) });
  } catch (error) {
    fail(res, error, 'Could not restore the version');
  }
});

/**
 * Use a Library picture (current or an older version) as a post's image. The picture is copied to
 * the post's own storage, so later Library changes don't alter a post that may already be scheduled.
 * Body: { taskId, versionId? }. The picture and the post must belong to the same account.
 */
router.post('/items/:id/use-on-post', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id);
    const versionId = typeof req.body?.versionId === 'string' && mongoose.isValidObjectId(req.body.versionId) ? req.body.versionId : asset.currentVersionId;
    const version = await LibraryVersion.findOne({ _id: versionId, assetId: asset._id });
    if (!version) throw new LibraryError(404, 'Version not found');
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(version.mime)) throw new LibraryError(400, 'Only pictures (PNG, JPG, WebP, GIF) can be used as a post image');
    const { task, ownerId } = await loadTaskForPublishing(req.user!, req.body?.taskId);
    if (String(asset.ownerId) !== String(ownerId)) throw new LibraryError(400, 'That picture is in another account’s Library');
    const buffer = await getObjectBuffer(version.s3Key, 25 * 1024 * 1024);
    const url = await uploadBufferToS3(buffer, version.mime.toLowerCase().replace('image/jpg', 'image/jpeg'), 'task-images');
    const dropped = setPicture(task, url);
    task.lastModifiedBy = req.user!._id as Id;
    await task.save();
    void deleteUnusedPictures(dropped);
    await logAudit({ action: AuditAction.EVENT_UPDATED, userId: req.user!._id as Id, targetType: 'Task', targetId: task._id as Id, metadata: { action: 'library-image-used', assetId: String(asset._id), versionId: String(version._id) }, req });
    res.json({ success: true, message: 'Picture updated', imageUrl: url, taskId: String(task._id) });
  } catch (error) {
    if (error instanceof PublishingError) return res.status(error.status).json({ success: false, message: error.message.replace(/task/gi, 'post') });
    fail(res, error, 'Could not use this picture on the post');
  }
});

router.post('/items/:id/reanalyze', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id);
    asset.aiStatus = 'pending';
    asset.aiError = undefined;
    await asset.save();
    await enqueueAnalyze(asset.ownerId as Id, asset._id as Id);
    invalidateOwner(asset.ownerId);
    res.json({ success: true, message: 'Queued for AI reading' });
  } catch (error) {
    fail(res, error, 'Could not queue the item');
  }
});

router.post('/items/:id/review', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id);
    const result = await resolveReview(asset, req.body?.action);
    res.json({ success: true, ...result });
  } catch (error) {
    fail(res, error, 'Could not apply the review');
  }
});

router.delete('/items/:id', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id);
    await trashAsset(asset);
    await logAudit({ action: AuditAction.LIBRARY_DELETED, userId: req.user!._id as Id, targetType: 'LibraryAsset', targetId: asset._id as Id, metadata: { title: asset.title, trash: true }, req });
    res.json({ success: true, message: 'Moved to trash. It is deleted for good after 30 days.' });
  } catch (error) {
    fail(res, error, 'Could not delete this item');
  }
});

router.post('/items/:id/restore', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id, { includeDeleted: true });
    if (!asset.deletedAt) throw new LibraryError(409, 'This item is not in the trash');
    await restoreAsset(asset);
    res.json({ success: true, message: 'Restored' });
  } catch (error) {
    fail(res, error, 'Could not restore this item');
  }
});

router.delete('/items/:id/permanent', isAuthenticated, requireLibrary, async (req: Request, res: Response) => {
  try {
    const asset = await loadAccessibleAsset(req.user!, req.params.id, { includeDeleted: true });
    if (!asset.deletedAt) throw new LibraryError(409, 'Move the item to the trash first');
    const title = asset.title;
    await purgeAsset(asset);
    await logAudit({ action: AuditAction.LIBRARY_DELETED, userId: req.user!._id as Id, targetType: 'LibraryAsset', targetId: asset._id as Id, metadata: { title, permanent: true }, req });
    res.json({ success: true, message: 'Deleted for good' });
  } catch (error) {
    fail(res, error, 'Could not delete this item');
  }
});

// ---------------------------------------------------------------------------
// Turn an imported event collection into a past campaign
// ---------------------------------------------------------------------------

/**
 * Creates a completed campaign from every Library item of one event (optionally one year), dated
 * from the items, and links the items that aren't linked to anything yet. The items stay in the
 * Library; the campaign makes the history visible on the calendar and in reports.
 */
router.post('/collections/campaign', isAuthenticated, requireLibrary, canCreateCampaign, async (req: Request, res: Response) => {
  try {
    const event = typeof req.body?.event === 'string' ? req.body.event.trim() : '';
    if (!event) throw new LibraryError(400, 'Choose an event');
    const year = Number(req.body?.year);
    const ownerId = req.user!._id as Id;
    const filter: Record<string, unknown> = { ownerId, deletedAt: null, event };
    if (Number.isInteger(year) && year > 1900 && year < 3000) {
      filter.capturedAt = { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };
    }
    const items = await LibraryAsset.find(filter).select('capturedAt links tags');
    if (!items.length) throw new LibraryError(404, 'No Library items found for this event');
    const dates = items.map((i) => i.capturedAt?.getTime()).filter((d): d is number => typeof d === 'number').sort((a, b) => a - b);
    const tags: string[] = [...new Set<string>(items.flatMap((i: { tags?: string[] }) => i.tags || []))].slice(0, 10);
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 200) : `${event}${Number.isInteger(year) ? ` ${year}` : ''}`;
    const campaign = await Campaign.create({
      name,
      description: `Past campaign rebuilt from ${items.length} Library item${items.length === 1 ? '' : 's'}.`,
      status: CampaignStatus.COMPLETED,
      startDate: dates.length ? new Date(dates[0]) : undefined,
      endDate: dates.length ? new Date(dates[dates.length - 1]) : undefined,
      // Stored without '#', like every other campaign (the app adds it when showing them).
      hashtags: tags.map((t) => t.replace(/[^\p{L}\p{N}_]/gu, '')).filter((t) => t.length > 0),
      createdBy: ownerId
    });
    const unlinked = items.filter((i) => !i.links?.campaignId && !i.links?.taskId && !i.links?.projectId).map((i) => i._id);
    if (unlinked.length) {
      await LibraryAsset.updateMany({ _id: { $in: unlinked } }, { $set: { 'links.campaignId': campaign._id } });
    }
    invalidateOwner(ownerId);
    await logAudit({ action: AuditAction.CAMPAIGN_CREATED, userId: ownerId, targetType: 'Campaign', targetId: campaign._id as Id, metadata: { fromLibraryEvent: event, items: items.length }, req });
    res.status(201).json({ success: true, campaign: { id: campaign._id, name: campaign.name }, linked: unlinked.length, items: items.length });
  } catch (error) {
    fail(res, error, 'Could not create the past campaign');
  }
});

// Multer errors (file too large / too many files) as friendly JSON.
router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 200 MB each' : err.code === 'LIMIT_FILE_COUNT' ? 'Upload up to 50 files at a time' : err.message;
    return res.status(413).json({ success: false, message });
  }
  next(err);
});

export default router;
