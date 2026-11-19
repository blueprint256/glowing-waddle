import express, { Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { Task, TaskStatus, type ITask } from '../models/Task';
import { SocialPost } from '../models/SocialPost';
import { Project } from '../models/Project';
import { Campaign } from '../models/Campaign';
import { User, UserRole } from '../models/User';
import { LibraryAsset } from '../models/LibraryAsset';
import { LibraryVersion } from '../models/LibraryVersion';
import { Comment } from '../models/Comment';
import { isAuthenticated } from '../middleware/auth';
import { canManageTasks } from '../middleware/rbac';
import { checkTaskOwnership } from '../middleware/ownership';
import { validateMongoId, validateTaskCreate, validateTaskUpdate } from '../middleware/validation';
import { queueTaskImage } from '../library/hooks';
import { onTaskDeleted } from '../services/lifecycle';
import { USER_SETTABLE_STATUSES, hasPublishingInPlay, normalizePostStatus } from '../services/postStatus';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { searchRegex } from '../utils/regex';
import { getObjectBuffer, uploadBufferToS3, uploadTaskImage } from '../utils/s3Service';
import { assertAllowance } from '../services/aiAllowance';
import { BUILTIN_IMPROVE_BRIEF, BUILTIN_IMPROVE_CAPTION, CAPTION_STYLES, aiErrorMessage, postContext, runPostCommand } from '../services/postAI';
import {
  MAX_REFERENCES,
  PostError,
  autoTitle,
  clearPicture,
  deleteUnusedPictures,
  newId,
  removeDraft,
  resolvePlacement,
  setPicture
} from '../services/posts';
import { changePicture, createPicture, tidyPictures } from '../services/postPicture';
import { isCorner, isFormat, isRole, type LogoCorner, type PictureFormat } from '../lib/postPicture';
import { AIError } from '../lib/aiError';

/**
 * Posts ("tasks" in the API). Post v2 (docs/POST_V2_PLAN.md): a post belongs to an account
 * (ownerId) and optionally to a campaign; themes are retired. Its picture has drafts (AI pictures
 * not chosen yet), up to 3 earlier pictures, and reference pictures for the AI.
 */

const router = express.Router();
type Id = mongoose.Types.ObjectId;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Use a PNG, JPG, WebP or GIF picture'));
  }
});

/** Runs multer and turns its errors (too big, wrong type) into a clear 400. */
const uploadPicture = (req: Request, res: Response, next: express.NextFunction) =>
  upload.single('image')(req, res, (err: unknown) => {
    if (!err) return next();
    const message = (err as any)?.code === 'LIMIT_FILE_SIZE' ? 'That picture is over 15 MB. Use a smaller one.' : (err as Error)?.message || 'Upload failed';
    res.status(400).json({ success: false, message });
  });

const POPULATE_CAMPAIGN = 'name startDate endDate archived createdBy';

async function populated(id: unknown) {
  return Task.findById(id)
    .populate('campaignId', POPULATE_CAMPAIGN)
    .populate('createdBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName');
}

/** One error answer for every route here. */
function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof PostError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof AIError) {
    const code = error.status === 429 && /image/i.test(error.message) ? { code: 'AI_IMAGE_LIMIT' } : {};
    return res.status(error.status).json({ success: false, message: error.message, ...code });
  }
  console.error(fallback, error);
  const { status, message } = aiErrorMessage(error, fallback);
  return res.status(status).json({ success: false, message });
}

async function loadTask(req: Request): Promise<ITask> {
  const task = await Task.findById(req.params.id);
  if (!task) throw new PostError(404, 'Post not found');
  return task;
}

/** The account's brand for true-to-life previews. */
async function brandOf(ownerId: unknown) {
  const owner = ownerId ? await User.findById(ownerId).select('companyInfo.companyName companyInfo.primaryLogoUrl firstName lastName') : null;
  return {
    name: owner?.companyInfo?.companyName || (owner ? `${owner.firstName} ${owner.lastName}`.trim() : ''),
    logoUrl: owner?.companyInfo?.primaryLogoUrl || null
  };
}

/** An old client may still send a theme (projectId): it stands for that theme's campaign. */
async function campaignFromTheme(projectId: unknown): Promise<string | undefined> {
  if (typeof projectId !== 'string' || !mongoose.isValidObjectId(projectId)) return undefined;
  const project = await Project.findById(projectId).select('campaignId');
  return project ? String(project.campaignId) : undefined;
}

const textOrUndefined = (v: unknown) => (typeof v === 'string' ? v : undefined);

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/**
 * @route POST /api/tasks
 * Body: { campaignId?, name?, description?, content?, taskDate?, status?, ownerId? (admins, for a
 * post without a campaign) }. Without a title, one is taken from the caption or the brief.
 */
router.post('/', isAuthenticated, canManageTasks, validateTaskCreate, async (req: Request, res: Response) => {
  try {
    const status = req.body.status === undefined || req.body.status === '' ? TaskStatus.DRAFT : normalizePostStatus(req.body.status);
    if (!status || !USER_SETTABLE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `A new post can be ${USER_SETTABLE_STATUSES.join(', ')}` });
    }
    const campaignInput = req.body.campaignId !== undefined ? req.body.campaignId : await campaignFromTheme(req.body.projectId);
    const { campaignId, ownerId } = await resolvePlacement(req.user!, { campaignId: campaignInput, ownerId: req.body.ownerId });

    const description = textOrUndefined(req.body.description);
    const content = textOrUndefined(req.body.content);
    const typed = textOrUndefined(req.body.name)?.trim() || '';
    const task = await Task.create({
      name: autoTitle(typed, content, description),
      autoName: !typed,
      description,
      content,
      ownerId,
      campaignId,
      status,
      taskDate: req.body.taskDate || null,
      createdBy: req.user!._id
    });

    await logAudit({
      action: AuditAction.EVENT_CREATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { name: task.name, campaignId: campaignId ? String(campaignId) : null },
      req
    });

    res.status(201).json({ success: true, message: 'Post created', task: await populated(task._id) });
  } catch (error) {
    fail(res, error, 'Error creating post');
  }
});

/**
 * @route GET /api/tasks
 * Filters: campaignId (ids, comma separated; "none" = posts without a campaign), status, dateFrom,
 * dateTo, unscheduled=true, excludeArchived=true, search, createdBy (admins: whose posts), sort=recent,
 * include=publishing, page, limit (≤ 5000). Older: projectId (posts that were in those themes).
 */
router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const and: Record<string, unknown>[] = [];
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',') : []).map((x) => x.trim()).filter(Boolean);
    const ids = (values: string[]) => values.filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(x));

    // People see their own posts; admins see everyone's (or the accounts they pick).
    if (req.user!.role !== UserRole.SYSTEM_ADMIN) and.push({ ownerId: req.user!._id });
    else if (req.query.createdBy) and.push({ ownerId: { $in: ids(list(req.query.createdBy)) } });

    if (req.query.campaignId) {
      const wanted = list(req.query.campaignId);
      const or: Record<string, unknown>[] = [];
      const campaignIds = ids(wanted);
      if (campaignIds.length) or.push({ campaignId: { $in: campaignIds } });
      if (wanted.includes('none')) or.push({ campaignId: null });
      and.push(or.length ? { $or: or } : { _id: null });
    }
    if (req.query.projectId) and.push({ projectId: { $in: ids(list(req.query.projectId)) } });

    if (req.query.status) {
      // Older names (Pending, Completed…) are translated, so saved filters and links keep working.
      and.push({ status: { $in: [...new Set(list(req.query.status).map((s) => normalizePostStatus(s)).filter(Boolean))] } });
    }

    // Unreadable dates are ignored rather than failing the request.
    const dateParam = (v: unknown) => {
      if (typeof v !== 'string' || !v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const dateFrom = dateParam(req.query.dateFrom);
    const dateTo = dateParam(req.query.dateTo);
    if (req.query.unscheduled === 'true') {
      and.push({ taskDate: null }); // the Planner's "No day yet" tray
    } else if (dateFrom || dateTo) {
      and.push({ taskDate: { ...(dateFrom ? { $gte: dateFrom } : {}), ...(dateTo ? { $lte: dateTo } : {}) } });
    }

    // Leave out posts of archived campaigns (posts without a campaign always stay).
    if (req.query.excludeArchived === 'true') {
      const archived = await Campaign.find({ archived: true }).select('_id').lean();
      if (archived.length) and.push({ campaignId: { $nin: archived.map((c) => c._id) } });
    }

    const searchPattern = searchRegex(req.query.search);
    if (searchPattern) and.push({ $or: [{ name: searchPattern }, { description: searchPattern }, { content: searchPattern }] });

    const query = and.length ? { $and: and } : {};
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit as string) || 1000));
    const skip = (page - 1) * limit;

    const [total, tasks] = await Promise.all([
      Task.countDocuments(query),
      Task.find(query)
        .select('-imageHistory -references -aiDrafts.prompt -aiDrafts.design -pictureDesign')
        .populate('campaignId', 'name archived')
        .populate('createdBy', 'firstName lastName')
        .populate('lastModifiedBy', 'firstName lastName')
        .sort(req.query.sort === 'recent' ? { createdAt: -1 } : { taskDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    // include=publishing: where and when each post goes out (one query for the whole page).
    let out: any[] = tasks;
    if (String(req.query.include || '').split(',').includes('publishing') && tasks.length) {
      const records = await SocialPost.find({ taskId: { $in: tasks.map((t) => t._id) }, status: { $ne: 'cancelled' } })
        .select('taskId platform status scheduledAt publishedAt')
        .lean();
      const byTask = new Map<string, any[]>();
      for (const r of records) byTask.set(String(r.taskId), [...(byTask.get(String(r.taskId)) || []), r]);
      out = tasks.map((t) => {
        const entries = byTask.get(String(t._id)) || [];
        const upcoming = entries.filter((r) => ['scheduled', 'publishing', 'processing', 'due'].includes(r.status) && r.scheduledAt);
        const published = entries.filter((r) => r.status === 'published');
        const next = upcoming.sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))[0];
        return {
          ...t.toObject(),
          publishing: entries.length
            ? {
                platforms: [...new Set(entries.filter((r) => r.status !== 'draft').map((r) => r.platform))],
                nextAt: next?.scheduledAt || null,
                publishedAt: published.reduce<Date | null>((latest, r) => (r.publishedAt && (!latest || +new Date(r.publishedAt) > +latest) ? new Date(r.publishedAt) : latest), null),
                failed: entries.some((r) => r.status === 'failed' || r.status === 'due')
              }
            : null
        };
      });
    }

    res.json({ success: true, tasks: out, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (error) {
    fail(res, error, 'Error fetching posts');
  }
});

/** @route GET /api/tasks/:id: the post, its campaign and the account's brand (for previews). */
router.get('/:id', isAuthenticated, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await populated(req.params.id);
    if (!task) throw new PostError(404, 'Post not found');
    res.json({ success: true, task, brand: await brandOf(task.ownerId) });
  } catch (error) {
    fail(res, error, 'Error fetching post');
  }
});

/**
 * @route PUT /api/tasks/:id
 * Body: any of { name ("" = automatic title), description, content, taskDate, status, campaignId
 * (an id, or null / "none" for no campaign) }.
 */
router.put('/:id', isAuthenticated, canManageTasks, validateMongoId('id'), validateTaskUpdate, checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const oldData = task.toObject();

    if (req.body.status !== undefined && req.body.status !== null && req.body.status !== '') {
      const status = normalizePostStatus(req.body.status);
      if (!status) throw new PostError(400, 'Unknown status');
      if (status !== task.status) {
        // Scheduled and Needs attention follow Publishing; they can't be set by hand.
        if (!USER_SETTABLE_STATUSES.includes(status)) {
          throw new PostError(400, `${status} is set by Publishing. Choose ${USER_SETTABLE_STATUSES.join(', ')}.`);
        }
        if (await hasPublishingInPlay(task._id as Id)) {
          throw new PostError(409, 'This post is scheduled or needs attention in Publishing. Cancel or fix it there first.');
        }
        task.status = status;
      }
    }

    // Move to another campaign of the same account, or out of its campaign.
    let moved = false;
    const campaignInput = req.body.campaignId !== undefined ? req.body.campaignId : await campaignFromTheme(req.body.projectId);
    const asKey = (v: unknown) => (v === null || v === undefined || v === '' || v === 'none' ? '' : String(v));
    // The editor sends the campaign with every save: only a different one is a move.
    if (campaignInput !== undefined && asKey(campaignInput) !== asKey(task.campaignId)) {
      const { campaignId } = await resolvePlacement(req.user!, { campaignId: campaignInput }, { ownerId: task.ownerId });
      if (String(campaignId || '') !== String(task.campaignId || '')) {
        task.campaignId = campaignId;
        task.projectId = null; // themes are retired: moving a post leaves its old theme
        moved = true;
      }
    }

    const description = textOrUndefined(req.body.description);
    const content = textOrUndefined(req.body.content);
    if (description !== undefined) task.description = description;
    if (content !== undefined) task.content = content;
    if (req.body.taskDate !== undefined) task.taskDate = req.body.taskDate || null;
    if (typeof req.body.name === 'string') {
      const typed = req.body.name.trim();
      task.autoName = !typed;
      if (typed) task.name = typed;
    }
    if (task.autoName) task.name = autoTitle('', task.content, task.description);

    task.lastModifiedBy = req.user!._id;
    await task.save();

    // Its scheduled copies and Library items follow it.
    if (moved) {
      await Promise.all([
        SocialPost.updateMany({ taskId: task._id }, { $set: { campaignId: task.campaignId || null } }),
        LibraryAsset.updateMany({ 'links.taskId': task._id }, { $set: { 'links.campaignId': task.campaignId || null, 'links.projectId': null } })
      ]);
    }

    await logAudit({
      action: AuditAction.EVENT_UPDATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      changes: { old: oldData, new: task.toObject() },
      req
    });

    res.json({ success: true, message: moved ? (task.campaignId ? 'Post moved' : 'Post taken out of its campaign') : 'Post saved', task: await populated(task._id) });
  } catch (error) {
    fail(res, error, 'Error updating post');
  }
});

/** @route DELETE /api/tasks/:id: also stops its scheduled posts and deletes pictures nothing else uses. */
router.delete('/:id', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    await Task.findByIdAndDelete(task._id);
    await Comment.deleteMany({ taskId: task._id });
    const { cancelledPosts } = await onTaskDeleted(task._id as Id, req.user!._id as Id);
    // Its pictures go too, unless a published or scheduled copy (or another post) still uses them.
    // Copies in the Library are separate files and stay.
    tidyPictures([
      task.designedImage || '',
      ...(task.imageHistory || []).map((h) => h.url),
      ...(task.aiDrafts || []).map((d) => d.url),
      ...(task.references || []).map((r) => r.url)
    ]);

    await logAudit({
      action: AuditAction.TASK_DELETED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { name: task.name, campaignId: task.campaignId ? String(task.campaignId) : null, cancelledPosts },
      req
    });

    res.json({
      success: true,
      message: cancelledPosts ? `Post deleted. ${cancelledPosts} scheduled post${cancelledPosts === 1 ? ' was' : 's were'} cancelled.` : 'Post deleted',
      cancelledPosts
    });
  } catch (error) {
    fail(res, error, 'Error deleting post');
  }
});

// ---------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------

/** The post with what the picture panel needs, after a picture change. */
async function pictureAnswer(res: Response, taskId: unknown, message: string, extra: Record<string, unknown> = {}) {
  res.json({ success: true, message, task: await populated(taskId), ...extra });
}

/** @route POST /api/tasks/:id/upload-image (form field "image"): becomes the post's picture. */
router.post('/:id/upload-image', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, uploadPicture, async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new PostError(400, 'Choose a picture to upload');
    const task = await loadTask(req);
    const url = await uploadTaskImage(req.file);
    const dropped = setPicture(task, url);
    task.lastModifiedBy = req.user!._id;
    await task.save();
    tidyPictures(dropped);
    void queueTaskImage(task, url, req.user!._id, 'Uploaded on the post');
    await pictureAnswer(res, task._id, 'Picture added');
  } catch (error) {
    fail(res, error, 'Error uploading the picture');
  }
});

/** @route DELETE /api/tasks/:id/image: removes the picture (it stays among the earlier pictures). */
router.delete('/:id/image', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    if (!task.designedImage) throw new PostError(400, 'This post has no picture');
    const dropped = clearPicture(task);
    task.lastModifiedBy = req.user!._id;
    await task.save();
    tidyPictures(dropped);
    await pictureAnswer(res, task._id, 'Picture removed');
  } catch (error) {
    fail(res, error, 'Error removing the picture');
  }
});

function pictureChoices(body: any, task: ITask): { format: PictureFormat; logo: LogoCorner | null } {
  const saved = task.pictureOptions || {};
  const format: PictureFormat = isFormat(body?.format) ? body.format : isFormat(saved.format) ? saved.format : 'square';
  const rawLogo = body?.logo !== undefined ? body.logo : saved.logo;
  return { format, logo: isCorner(rawLogo) ? rawLogo : null };
}

/**
 * @route POST /api/tasks/:id/image/create
 * Body: { description? (unsaved "What's this post about?"), format?: square|portrait|landscape,
 * logo?: top-left|top-right|bottom-left|bottom-right|null }. Adds an AI draft; 15–60 seconds.
 */
router.post('/:id/image/create', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    await assertAllowance(req.user!, 'images');
    const task = await loadTask(req);
    const choices = pictureChoices(req.body, task);
    const { draft, dropped } = await createPicture(task, {
      description: textOrUndefined(req.body?.description),
      format: choices.format,
      logo: choices.logo,
      userId: req.user!._id as Id
    });
    task.pictureOptions = { format: choices.format, logo: choices.logo };
    await task.save();
    tidyPictures(dropped);
    await pictureAnswer(res, task._id, 'AI picture ready', { draft });
  } catch (error) {
    fail(res, error, 'Couldn’t create the picture. Try again.');
  }
});

/**
 * @route POST /api/tasks/:id/image/change
 * Body: { instruction, from? (the picture to change: the current one by default), logo? }.
 * Adds an AI draft with the change; the rest of the picture is kept.
 */
router.post('/:id/image/change', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    await assertAllowance(req.user!, 'images');
    const task = await loadTask(req);
    const from = textOrUndefined(req.body?.from) || task.designedImage || task.aiDrafts?.[0]?.url;
    if (!from) throw new PostError(400, 'There’s no picture to change yet. Create or add one first.');
    const { logo } = pictureChoices(req.body, task);
    const { draft, dropped } = await changePicture(task, { instruction: req.body?.instruction, from, logo, userId: req.user!._id as Id });
    await task.save();
    tidyPictures(dropped);
    await pictureAnswer(res, task._id, 'Changed picture ready', { draft });
  } catch (error) {
    fail(res, error, 'Couldn’t change the picture. Try again.');
  }
});

/**
 * @route POST /api/tasks/:id/image/use
 * Body: { url } of an AI draft or an earlier picture: it becomes the post's picture.
 */
router.post('/:id/image/use', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const url = textOrUndefined(req.body?.url) || '';
    if (url && url === task.designedImage) return pictureAnswer(res, task._id, 'That’s already the picture');
    const draft = (task.aiDrafts || []).find((d) => d.url === url);
    const earlier = (task.imageHistory || []).find((h) => h.url === url);
    if (!draft && !earlier) throw new PostError(400, 'That picture isn’t one of this post’s pictures');
    if (draft) removeDraft(task, draft.id);
    // A designed poster keeps its document, so it can be edited and printed later.
    const dropped = setPicture(task, url, undefined, draft ? (draft.kind === 'design' ? draft.design || null : null) : undefined);
    task.lastModifiedBy = req.user!._id;
    await task.save();
    tidyPictures(dropped);
    void queueTaskImage(task, url, req.user!._id, draft ? (draft.kind === 'change' ? `AI change: ${draft.prompt}`.slice(0, 300) : 'AI picture') : 'Earlier picture brought back');
    await logAudit({
      action: AuditAction.EVENT_UPDATED,
      userId: req.user!._id,
      targetType: 'Task',
      targetId: task._id,
      metadata: { action: draft ? 'ai-picture-used' : 'earlier-picture-used', imageUrl: url },
      req
    });
    await pictureAnswer(res, task._id, draft ? 'Picture updated' : 'Earlier picture brought back');
  } catch (error) {
    fail(res, error, 'Error updating the picture');
  }
});

/** @route DELETE /api/tasks/:id/image/drafts/:draftId: discards an AI draft (its file is deleted). */
router.delete('/:id/image/drafts/:draftId', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const url = removeDraft(task, String(req.params.draftId));
    if (!url) throw new PostError(404, 'That AI picture was already discarded');
    await task.save();
    tidyPictures([url]);
    await pictureAnswer(res, task._id, 'AI picture discarded');
  } catch (error) {
    fail(res, error, 'Error discarding the AI picture');
  }
});

// ---------------------------------------------------------------------------
// Reference pictures (what Create image should include, or whose style to follow)
// ---------------------------------------------------------------------------

function referenceName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return (name || fallback).slice(0, 120);
}

/**
 * @route POST /api/tasks/:id/references
 * A file (form field "image", plus "role"), or JSON { libraryAssetId, versionId?, role }, or
 * { url, role } for one of the post's own pictures. role: include (default) | style. At most 6.
 */
router.post('/:id/references', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, uploadPicture, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    if ((task.references || []).length >= MAX_REFERENCES) throw new PostError(400, `A post can have ${MAX_REFERENCES} reference pictures. Remove one first.`);
    const role = isRole(req.body?.role) ? req.body.role : 'include';
    let url = '';
    let name = '';
    if (req.file) {
      url = await uploadBufferToS3(req.file.buffer, req.file.mimetype.toLowerCase().replace('image/jpg', 'image/jpeg'), 'post-references');
      name = referenceName(req.file.originalname, 'Reference picture');
    } else if (typeof req.body?.libraryAssetId === 'string' && mongoose.isValidObjectId(req.body.libraryAssetId)) {
      const asset = await LibraryAsset.findById(req.body.libraryAssetId);
      if (!asset || asset.deletedAt || String(asset.ownerId) !== String(task.ownerId)) throw new PostError(404, 'That picture isn’t in this account’s Library');
      const versionId = typeof req.body.versionId === 'string' && mongoose.isValidObjectId(req.body.versionId) ? req.body.versionId : asset.currentVersionId;
      const version = await LibraryVersion.findOne({ _id: versionId, assetId: asset._id });
      if (!version) throw new PostError(404, 'Version not found');
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(version.mime)) throw new PostError(400, 'Only pictures (PNG, JPG, WebP, GIF) can be references');
      // A copy, so later Library changes don't alter the post.
      const buffer = await getObjectBuffer(version.s3Key, 25 * 1024 * 1024);
      url = await uploadBufferToS3(buffer, version.mime.toLowerCase().replace('image/jpg', 'image/jpeg'), 'post-references');
      name = referenceName(asset.title || version.originalName, 'Library picture');
    } else if (typeof req.body?.url === 'string') {
      const own = [task.designedImage, ...(task.imageHistory || []).map((h) => h.url), ...(task.aiDrafts || []).map((d) => d.url)];
      if (!own.includes(req.body.url)) throw new PostError(400, 'Only this post’s own pictures can be added by address');
      url = req.body.url;
      name = 'This post’s picture';
    } else {
      throw new PostError(400, 'Choose a picture to add');
    }
    if ((task.references || []).some((r) => r.url === url)) throw new PostError(409, 'That picture is already a reference');
    task.references = [...(task.references || []), { id: newId(), url, role, name, at: new Date() }] as any;
    await task.save();
    await pictureAnswer(res, task._id, role === 'style' ? 'Style picture added' : 'Reference picture added');
  } catch (error) {
    fail(res, error, 'Error adding the reference picture');
  }
});

/** @route PATCH /api/tasks/:id/references/:refId  Body: { role?, name? } */
router.patch('/:id/references/:refId', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const ref = (task.references || []).find((r) => r.id === req.params.refId);
    if (!ref) throw new PostError(404, 'Reference picture not found');
    if (req.body?.role !== undefined) {
      if (!isRole(req.body.role)) throw new PostError(400, 'role must be include or style');
      ref.role = req.body.role;
    }
    if (typeof req.body?.name === 'string') ref.name = referenceName(req.body.name, ref.name || 'Reference picture');
    task.markModified('references');
    await task.save();
    await pictureAnswer(res, task._id, 'Reference picture updated');
  } catch (error) {
    fail(res, error, 'Error updating the reference picture');
  }
});

/** @route DELETE /api/tasks/:id/references/:refId */
router.delete('/:id/references/:refId', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const ref = (task.references || []).find((r) => r.id === req.params.refId);
    if (!ref) throw new PostError(404, 'Reference picture not found');
    task.references = (task.references || []).filter((r) => r.id !== ref.id) as any;
    await task.save();
    void deleteUnusedPictures([ref.url]);
    await pictureAnswer(res, task._id, 'Reference picture removed');
  } catch (error) {
    fail(res, error, 'Error removing the reference picture');
  }
});

// ---------------------------------------------------------------------------
// Writing help
// ---------------------------------------------------------------------------

/**
 * @route POST /api/tasks/improve-caption
 * Write / improve a caption for a post that isn't created yet. Body: { style?, caption?, brief?,
 * campaignId? }. Uses your brand (and the campaign, if it's yours). Suggestion only.
 */
router.post('/improve-caption', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : '';
    const brief = typeof req.body?.brief === 'string' ? req.body.brief : '';
    let styleKey = typeof req.body?.style === 'string' && CAPTION_STYLES[req.body.style] ? req.body.style : 'improve';
    if (!caption.trim()) styleKey = 'write';
    if (styleKey === 'write' && !brief.trim()) throw new PostError(400, 'Say what the post is about first (“What’s this post about?”), so the AI knows what to write.');
    const { campaignId, ownerId } = await resolvePlacement(req.user!, { campaignId: req.body?.campaignId });
    const style = CAPTION_STYLES[styleKey];
    const [campaign, owner] = await Promise.all([campaignId ? Campaign.findById(campaignId) : Promise.resolve(null), User.findById(ownerId).select('companyInfo')]);
    const { text } = await runPostCommand(
      'improve-caption',
      { name: 'Improve caption', template: BUILTIN_IMPROVE_CAPTION },
      {
        taskName: '',
        taskDescription: brief,
        taskContent: caption,
        instruction: style.instruction,
        platform: style.platform || '',
        ...(campaign ? { campaignDetails: campaign } : {}),
        ...(owner?.companyInfo ? { companyInfo: owner.companyInfo } : {})
      },
      req.user!._id as Id
    );
    res.json({ success: true, style: styleKey, label: style.label, original: caption, suggestion: text });
  } catch (error) {
    fail(res, error, 'Couldn’t improve the caption. Try again.');
  }
});

/**
 * @route POST /api/tasks/:id/improve-caption
 * Body: { style?, caption?, brief? } (unsaved text to work from). Returns a suggestion; nothing is saved.
 */
router.post('/:id/improve-caption', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : task.content || '';
    const brief = typeof req.body?.brief === 'string' ? req.body.brief : task.description || '';
    let styleKey = typeof req.body?.style === 'string' && CAPTION_STYLES[req.body.style] ? req.body.style : 'improve';
    if (!caption.trim()) styleKey = 'write';
    const typedTitle = task.autoName ? '' : task.name.trim();
    if (styleKey === 'write' && !brief.trim() && !typedTitle) {
      throw new PostError(400, 'Say what the post is about first (“What’s this post about?”), so the AI knows what to write.');
    }
    const style = CAPTION_STYLES[styleKey];
    const { campaign, companyInfo } = await postContext(task, req.user!._id as Id);
    const { text } = await runPostCommand(
      'improve-caption',
      { name: 'Improve caption', template: BUILTIN_IMPROVE_CAPTION },
      {
        taskName: typedTitle,
        taskDescription: brief,
        taskContent: caption,
        instruction: style.instruction,
        platform: style.platform || '',
        ...(campaign ? { campaignDetails: campaign } : {}),
        ...(companyInfo ? { companyInfo } : {})
      },
      req.user!._id as Id
    );
    res.json({ success: true, style: styleKey, label: style.label, original: caption, suggestion: text });
  } catch (error) {
    fail(res, error, 'Couldn’t improve the caption. Try again.');
  }
});

/**
 * @route POST /api/tasks/:id/refine-description
 * Improve brief (kept for the connector; the app no longer shows it). Suggestion only.
 */
router.post('/:id/refine-description', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const brief = typeof req.body?.brief === 'string' ? req.body.brief : task.description || '';
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : task.content || '';
    if (!brief.trim() && !caption.trim()) throw new PostError(400, 'Write a few words about the post first.');
    const { campaign, companyInfo } = await postContext(task, req.user!._id as Id);
    const { text } = await runPostCommand(
      'refine-task-description',
      { name: 'Improve brief', template: BUILTIN_IMPROVE_BRIEF },
      {
        taskName: task.autoName ? '' : task.name,
        taskDescription: brief,
        taskContent: caption,
        ...(campaign ? { campaignDetails: campaign } : {}),
        ...(companyInfo ? { companyInfo } : {})
      },
      req.user!._id as Id
    );
    res.json({ success: true, message: 'Suggestion ready', originalDescription: brief, refinedDescription: text });
  } catch (error) {
    fail(res, error, 'Couldn’t improve the brief. Try again.');
  }
});

// ---------------------------------------------------------------------------
// Older picture endpoints (the connector and older clients)
// ---------------------------------------------------------------------------

/** @route POST /api/tasks/:id/generate-poster: Create image with the post's saved choices. */
router.post('/:id/generate-poster', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    await assertAllowance(req.user!, 'images');
    const task = await loadTask(req);
    const choices = pictureChoices({}, task);
    const { draft, dropped } = await createPicture(task, { format: choices.format, logo: choices.logo, userId: req.user!._id as Id });
    await task.save();
    tidyPictures(dropped);
    res.json({ success: true, message: 'AI picture ready', generatedImageUrl: draft.url, draft });
  } catch (error) {
    fail(res, error, 'Couldn’t create the picture. Try again.');
  }
});

/** @route PATCH /api/tasks/:id/adopt-poster: uses the newest AI draft. */
router.patch('/:id/adopt-poster', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const draft = task.aiDrafts?.[0];
    if (!draft) throw new PostError(400, 'There’s no AI picture to use');
    removeDraft(task, draft.id);
    const dropped = setPicture(task, draft.url);
    task.lastModifiedBy = req.user!._id;
    await task.save();
    tidyPictures(dropped);
    void queueTaskImage(task, draft.url, req.user!._id, 'AI picture');
    await pictureAnswer(res, task._id, 'Picture updated');
  } catch (error) {
    fail(res, error, 'Error using the AI picture');
  }
});

/** @route PATCH /api/tasks/:id/discard-poster: discards the newest AI draft. */
router.patch('/:id/discard-poster', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await loadTask(req);
    const draft = task.aiDrafts?.[0];
    if (!draft) throw new PostError(400, 'There’s no AI picture to discard');
    removeDraft(task, draft.id);
    await task.save();
    tidyPictures([draft.url]);
    await pictureAnswer(res, task._id, 'AI picture discarded');
  } catch (error) {
    fail(res, error, 'Error discarding the AI picture');
  }
});

export default router;
