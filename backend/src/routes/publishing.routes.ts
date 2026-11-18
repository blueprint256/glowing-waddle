import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { canUsePublishing } from '../models/User';
import { AppConfig } from '../models/AppConfig';
import { LibraryAsset } from '../models/LibraryAsset';
import { LibraryVersion } from '../models/LibraryVersion';
import { SocialPost } from '../models/SocialPost';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { getFrontendUrl } from '../config/publicUrl';
import { PROVIDERS, ProviderId } from '../publishing/types';
import { ADAPTERS } from '../publishing/registry';
import { RULES } from '../publishing/rules';
import { loadPublishingSetup, invalidatePublishingSetup } from '../publishing/setup';
import { encryptSecret, decryptSecret, maskSecret } from '../publishing/secrets';
import { links } from '../lib/links';
import {
  PublishingError,
  resolveOwner,
  loadTaskForPublishing,
  loadPostForUser,
  loadChannelForUser,
  platformStatus,
  listChannels,
  startConnect,
  finishConnect,
  addTestChannel,
  removeChannel,
  channelOptions,
  checkPosts,
  createPosts,
  updatePost,
  cancelPost,
  retryPost,
  markPublished,
  deletePost,
  postDownloadUrl,
  listPosts,
  countsFor,
  shapePost,
  callbackUrl
} from '../publishing/service';

/**
 * Publishing API: connected accounts (channels), posts (schedule / post now / post by hand), and the
 * admin's per-platform app keys. Posts for a task go to the campaign owner's channels.
 */
const router = express.Router();
type Id = mongoose.Types.ObjectId;

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof PublishingError) return res.status(error.status).json({ success: false, message: error.message, details: error.details });
  const message = (error as any)?.message;
  console.error(`[publishing] ${fallback}:`, error);
  return res.status(500).json({ success: false, message: message && message.length < 300 ? `${fallback}: ${message}` : fallback });
}

async function requirePublishing(req: Request, res: Response, next: NextFunction) {
  try {
    const setup = await loadPublishingSetup();
    if (!setup.enabled) return res.status(403).json({ success: false, code: 'PUBLISHING_DISABLED', message: 'Publishing is switched off for this workspace.' });
    if (!canUsePublishing(req.user!)) return res.status(403).json({ success: false, code: 'PUBLISHING_DISABLED_FOR_USER', message: 'Your administrator has turned publishing off for your account.' });
    next();
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Sign-in return from a platform (no app session needed: the state record identifies the user)
// ---------------------------------------------------------------------------

router.get('/oauth/:provider/callback', async (req: Request, res: Response) => {
  const front = `${getFrontendUrl()}${links.publishing('accounts')}`;
  const q = req.query as Record<string, string | undefined>;
  if (q.error || q.error_description) {
    return res.redirect(`${front}&connect=error&message=${encodeURIComponent(q.error_description || q.error || 'Sign-in was cancelled')}`);
  }
  try {
    if (!q.code || !q.state) throw new PublishingError(400, 'The sign-in did not complete');
    const result = await finishConnect(req.params.provider, q.code, q.state, req);
    await logAudit({ action: AuditAction.CHANNEL_CONNECTED, userId: result.ownerId, targetType: 'User', targetId: result.ownerId, metadata: { provider: req.params.provider, accounts: result.saved } });
    const back = result.returnTo && result.returnTo.startsWith('/') && !result.returnTo.startsWith('//') ? `${getFrontendUrl()}${result.returnTo}` : front;
    const sep = back.includes('?') ? '&' : '?';
    res.redirect(`${back}${sep}connect=ok&count=${result.saved.length}`);
  } catch (error: any) {
    console.error('[publishing] connect failed:', error);
    const message = error instanceof PublishingError || error?.name === 'PublishError' ? error.message : 'Could not connect the account';
    res.redirect(`${front}&connect=error&message=${encodeURIComponent(String(message).slice(0, 300))}`);
  }
});

// ---------------------------------------------------------------------------
// Status & channels
// ---------------------------------------------------------------------------

router.get('/status', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const setup = await loadPublishingSetup();
    const ownerId = req.user!._id as Id;
    const available = setup.enabled && canUsePublishing(req.user!);
    res.json({
      success: true,
      available,
      reason: !setup.enabled ? 'Publishing is switched off for this workspace.' : !canUsePublishing(req.user!) ? 'Your administrator has turned publishing off for your account.' : undefined,
      testMode: setup.testMode,
      platforms: (await platformStatus()).map((p) => ({ ...p, rules: { maxText: RULES[p.id].maxText, videoRequired: RULES[p.id].videoRequired, mediaRequired: RULES[p.id].mediaRequired, titleRequired: RULES[p.id].titleRequired } })),
      counts: available ? await countsFor(ownerId) : null
    });
  } catch (error) {
    fail(res, error, 'Could not load publishing status');
  }
});

router.get('/channels', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, channels: await listChannels(resolveOwner(req.user!, req.query.ownerId)) });
  } catch (error) {
    fail(res, error, 'Could not load accounts');
  }
});

router.post('/connect/:provider', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const ownerId = resolveOwner(req.user!, req.body?.ownerId);
    const returnTo = typeof req.body?.returnTo === 'string' ? req.body.returnTo.slice(0, 300) : undefined;
    res.json({ success: true, url: await startConnect(req.user!, ownerId, req.params.provider, req, returnTo) });
  } catch (error) {
    fail(res, error, 'Could not start connecting');
  }
});

router.post('/channels/test', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const ownerId = resolveOwner(req.user!, req.body?.ownerId);
    res.status(201).json({ success: true, channel: await addTestChannel(req.user!, ownerId, String(req.body?.platform || '')) });
  } catch (error) {
    fail(res, error, 'Could not add the test account');
  }
});

router.get('/channels/:id/options', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const channel = await loadChannelForUser(req.user!, req.params.id);
    res.json({ success: true, options: await channelOptions(channel) });
  } catch (error) {
    fail(res, error, 'Could not load the account settings');
  }
});

router.delete('/channels/:id', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const channel = await loadChannelForUser(req.user!, req.params.id);
    await removeChannel(channel, req.user!._id as Id);
    await logAudit({ action: AuditAction.CHANNEL_DISCONNECTED, userId: req.user!._id as Id, targetType: 'SocialChannel', targetId: channel._id as Id, metadata: { platform: channel.platform, name: channel.name }, req });
    res.json({ success: true, message: 'Disconnected' });
  } catch (error) {
    fail(res, error, 'Could not disconnect');
  }
});

// ---------------------------------------------------------------------------
// What can be posted from a task
// ---------------------------------------------------------------------------

router.get('/tasks/:taskId/media', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const { task, ownerId } = await loadTaskForPublishing(req.user!, req.params.taskId);
    const items: { source: 'url' | 'library'; url?: string; assetId?: string; label: string; kind: 'image' | 'video'; previewUrl?: string; isMain?: boolean }[] = [];
    if (task.designedImage) items.push({ source: 'url', url: task.designedImage, label: 'Post picture', kind: 'image', previewUrl: task.designedImage, isMain: true });
    const assets = await LibraryAsset.find({ ownerId, 'links.taskId': task._id, deletedAt: null, kind: { $in: ['image', 'video'] } })
      .sort({ updatedAt: -1 })
      .limit(20)
      .select('title kind currentVersionId');
    for (const a of assets) {
      const v = await LibraryVersion.findById(a.currentVersionId).select('mime');
      if (!v) continue;
      items.push({ source: 'library', assetId: String(a._id), label: `Library · ${a.title}`, kind: v.mime.startsWith('video/') ? 'video' : 'image', previewUrl: `/api/library/items/${a._id}/file?variant=thumb` });
    }
    res.json({ success: true, task: { id: String(task._id), name: task.name, content: task.content || '', taskDate: task.taskDate || null }, media: items });
  } catch (error) {
    fail(res, error, 'Could not load the post’s files');
  }
});

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

async function ownerForBody(req: Request) {
  if (req.body?.taskId) {
    const { task, ownerId } = await loadTaskForPublishing(req.user!, req.body.taskId);
    return { ownerId, taskId: task._id as Id, campaignId: (task.campaignId as Id) || undefined };
  }
  return { ownerId: resolveOwner(req.user!, req.body?.ownerId) };
}

router.post('/posts/check', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const { ownerId } = await ownerForBody(req);
    const result = await checkPosts(ownerId, { text: String(req.body?.text || ''), media: req.body?.media || [], targets: req.body?.targets || [], options: req.body?.options });
    res.json({ success: true, ok: result.ok, targets: result.targets });
  } catch (error) {
    fail(res, error, 'Could not check the post');
  }
});

router.post('/posts', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const ctx = await ownerForBody(req);
    const when = ['now', 'schedule', 'draft'].includes(req.body?.when) ? req.body.when : 'schedule';
    const posts = await createPosts(req.user!, ctx.ownerId, { ...req.body, text: String(req.body?.text || ''), when }, ctx);
    await SocialPost.populate(posts, [{ path: 'channelId', select: 'name username avatarUrl platform simulated status' }, { path: 'taskId', select: 'name' }, { path: 'campaignId', select: 'name' }]);
    await logAudit({ action: AuditAction.POST_SCHEDULED, userId: req.user!._id as Id, targetType: 'Task', targetId: ctx.taskId, metadata: { when, platforms: posts.map((p) => p.platform), groupId: posts[0]?.groupId }, req });
    res.status(201).json({ success: true, posts: posts.map(shapePost) });
  } catch (error) {
    fail(res, error, 'Could not schedule the post');
  }
});

router.get('/posts', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    let ownerId = resolveOwner(req.user!, q.ownerId);
    if (q.taskId) ownerId = (await loadTaskForPublishing(req.user!, q.taskId)).ownerId;
    const day = (s?: string, end = false) => {
      if (!s) return null;
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : s);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    res.json({
      success: true,
      ...(await listPosts(ownerId, { status: q.status, taskId: q.taskId, campaignId: q.campaignId, platform: q.platform, from: day(q.from), to: day(q.to, true), page: Number(q.page) || 1, limit: Number(q.limit) || 50 }))
    });
  } catch (error) {
    fail(res, error, 'Could not load posts');
  }
});

router.get('/posts/:id', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const post = await loadPostForUser(req.user!, req.params.id);
    await post.populate([{ path: 'channelId', select: 'name username avatarUrl platform simulated status' }, { path: 'taskId', select: 'name' }, { path: 'campaignId', select: 'name' }]);
    res.json({ success: true, post: shapePost(post) });
  } catch (error) {
    fail(res, error, 'Could not load the post');
  }
});

router.patch('/posts/:id', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const post = await loadPostForUser(req.user!, req.params.id);
    res.json({ success: true, post: shapePost(await updatePost(req.user!, post, req.body || {})) });
  } catch (error) {
    fail(res, error, 'Could not save the post');
  }
});

router.post('/posts/:id/cancel', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, post: shapePost(await cancelPost(req.user!, await loadPostForUser(req.user!, req.params.id))) });
  } catch (error) {
    fail(res, error, 'Could not cancel the post');
  }
});

router.post('/posts/:id/retry', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, post: shapePost(await retryPost(req.user!, await loadPostForUser(req.user!, req.params.id))) });
  } catch (error) {
    fail(res, error, 'Could not retry the post');
  }
});

router.post('/posts/:id/mark-published', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const post = await loadPostForUser(req.user!, req.params.id);
    res.json({ success: true, post: shapePost(await markPublished(req.user!, post, typeof req.body?.url === 'string' ? req.body.url.trim() : undefined)) });
  } catch (error) {
    fail(res, error, 'Could not update the post');
  }
});

router.delete('/posts/:id', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    await deletePost(await loadPostForUser(req.user!, req.params.id));
    res.json({ success: true, message: 'Removed' });
  } catch (error) {
    fail(res, error, 'Could not remove the post');
  }
});

/** Download one of a post's files (for posting by hand). */
router.get('/posts/:id/files/:index', isAuthenticated, requirePublishing, async (req: Request, res: Response) => {
  try {
    const post = await loadPostForUser(req.user!, req.params.id);
    const url = await postDownloadUrl(post, Number(req.params.index));
    res.set('Cache-Control', 'private, no-store');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin'); // the app may run on another address than the API (e.g. localhost:3000 vs :5000); without this, browsers refuse to show the image
    res.redirect(302, url);
  } catch (error) {
    fail(res, error, 'Could not open the file');
  }
});

// ---------------------------------------------------------------------------
// Admin: switch platforms on by adding their app keys
// ---------------------------------------------------------------------------

async function settingsPayload(req: Request) {
  const config = await AppConfig.getConfig();
  const stored = (config.publishingProviders || {}) as Record<string, any>;
  return {
    enabled: config.publishingEnabled !== false,
    testMode: config.publishingTestMode !== false,
    providers: PROVIDERS.map((id) => {
      const s = stored[id] || {};
      let secretHint = '';
      try {
        secretHint = maskSecret(decryptSecret(s.clientSecretEnc));
      } catch {
        secretHint = s.clientSecretEnc ? '(unreadable: re-enter it)' : '';
      }
      const a = ADAPTERS[id];
      return {
        id,
        name: a.name,
        platforms: a.platforms,
        enabled: s.enabled === true,
        clientId: s.clientId || '',
        secretHint,
        hasSecret: Boolean(secretHint),
        options: s.options || {},
        optionFields: a.optionFields || [],
        callbackUrl: callbackUrl(id, req),
        developerPortal: a.developerPortal,
        approvalNote: a.approvalNote,
        updatedAt: s.updatedAt || null
      };
    })
  };
}

router.get('/settings', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, settings: await settingsPayload(req) });
  } catch (error) {
    fail(res, error, 'Could not load publishing settings');
  }
});

router.patch('/settings', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const config = await AppConfig.getConfig();
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== 'boolean') throw new PublishingError(400, 'enabled must be true or false');
      config.publishingEnabled = b.enabled;
    }
    if (b.testMode !== undefined) {
      if (typeof b.testMode !== 'boolean') throw new PublishingError(400, 'testMode must be true or false');
      config.publishingTestMode = b.testMode;
    }
    if (b.providers !== undefined) {
      if (typeof b.providers !== 'object' || Array.isArray(b.providers)) throw new PublishingError(400, 'providers must be an object');
      const stored = { ...((config.publishingProviders || {}) as Record<string, any>) };
      for (const [id, p] of Object.entries(b.providers as Record<string, any>)) {
        if (!PROVIDERS.includes(id as ProviderId)) throw new PublishingError(400, `Unknown platform: ${id}`);
        const cur = { ...(stored[id] || {}) };
        if (p.enabled !== undefined) cur.enabled = Boolean(p.enabled);
        if (typeof p.clientId === 'string') cur.clientId = p.clientId.trim().slice(0, 300);
        if (typeof p.clientSecret === 'string' && p.clientSecret.trim()) cur.clientSecretEnc = encryptSecret(p.clientSecret.trim().slice(0, 500));
        if (p.clearSecret === true) cur.clientSecretEnc = undefined;
        if (p.options && typeof p.options === 'object') {
          const allowed = new Set((ADAPTERS[id as ProviderId].optionFields || []).map((f) => f.key));
          const opts: Record<string, unknown> = { ...(cur.options || {}) };
          for (const [k, v] of Object.entries(p.options)) {
            if (!allowed.has(k)) continue;
            opts[k] = typeof v === 'boolean' ? v : String(v ?? '').trim().slice(0, 50);
          }
          cur.options = opts;
        }
        if (cur.enabled && !(cur.clientId && cur.clientSecretEnc)) throw new PublishingError(400, `Add the ${ADAPTERS[id as ProviderId].name} client ID and secret before switching it on`);
        cur.updatedAt = new Date();
        stored[id] = cur;
      }
      config.publishingProviders = stored;
      config.markModified('publishingProviders');
    }
    await config.save();
    invalidatePublishingSetup();
    await logAudit({ action: AuditAction.PUBLISHING_SETTINGS_UPDATED, userId: req.user!._id as Id, metadata: { enabled: b.enabled, testMode: b.testMode, providers: b.providers ? Object.keys(b.providers) : [] }, req });
    res.json({ success: true, message: 'Publishing settings saved', settings: await settingsPayload(req) });
  } catch (error) {
    fail(res, error, 'Could not save publishing settings');
  }
});

export default router;
