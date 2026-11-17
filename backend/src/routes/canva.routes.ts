import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import sharp from 'sharp';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { AppConfig } from '../models/AppConfig';
import { CanvaEdit } from '../models/CanvaEdit';
import { PublishingConnect } from '../models/PublishingConnect';
import { LibraryVersion } from '../models/LibraryVersion';
import { getPublicBaseUrl, getFrontendUrl } from '../config/publicUrl';
import { getObjectBuffer, objectKeyFromUrl, downloadImageFromUrl, uploadBufferToS3 } from '../utils/s3Service';
import { encryptSecret, decryptSecret, maskSecret, pkcePair } from '../publishing/secrets';
import { PublishError } from '../publishing/types';
import { PublishingError, loadTaskForPublishing } from '../publishing/service';
import { loadAccessibleAsset, ingest, LibraryError } from '../library/service';
import { queueTaskImage } from '../library/hooks';
import { links } from '../lib/links';
import {
  loadCanvaSettings,
  canvaAuthorizeUrl,
  canvaExchangeCode,
  saveCanvaTokens,
  clearCanvaTokens,
  canvaToken,
  canvaUploadAsset,
  canvaCreateDesign,
  canvaDesignSize,
  canvaExportPng,
  correlationFromJwt
} from '../canva/client';

/**
 * Canva: "Edit in Canva" for Library pictures and task images. The user edits in Canva with their own
 * account; pressing "Return to Blueprint" (or "Bring back from Canva") saves the result as a new version.
 * Mounted at /api/integrations/canva (keeps the existing Settings → Connect Canva button working).
 */
const router = express.Router();
type Id = mongoose.Types.ObjectId;

const callbackUrl = (req?: Request) => process.env.CANVA_CALLBACK_URL?.trim() || `${getPublicBaseUrl(req)}/api/integrations/canva/callback`;
const returnUrl = (req?: Request) => `${getPublicBaseUrl(req)}/api/integrations/canva/return`;

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof PublishingError || error instanceof LibraryError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof PublishError) return res.status(502).json({ success: false, message: error.message });
  console.error(`[canva] ${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
}

function safeReturnTo(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value.slice(0, 300) : undefined;
}

// ---------------------------------------------------------------------------
// Connect / disconnect (each user connects their own Canva account)
// ---------------------------------------------------------------------------

router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  const front = getFrontendUrl();
  try {
    const s = await loadCanvaSettings();
    if (!s.ready) return res.redirect(`${front}/settings/integrations?integration=canva&status=error&message=not_configured`);
    const { verifier, challenge } = pkcePair();
    const state = crypto.randomBytes(24).toString('base64url');
    await PublishingConnect.create({ state, userId: req.user!._id, ownerId: req.user!._id, provider: 'canva', codeVerifier: verifier, returnTo: safeReturnTo(req.query.returnTo) });
    res.redirect(canvaAuthorizeUrl(s, callbackUrl(req), state, challenge));
  } catch (error) {
    console.error('[canva] connect failed:', error);
    res.redirect(`${front}/settings/integrations?integration=canva&status=error&message=server_error`);
  }
});

router.get('/callback', async (req: Request, res: Response) => {
  const front = getFrontendUrl();
  const q = req.query as Record<string, string | undefined>;
  if (q.error) return res.redirect(`${front}/settings/integrations?integration=canva&status=error&message=${encodeURIComponent(q.error)}`);
  try {
    const pending = q.state ? await PublishingConnect.findOneAndDelete({ state: q.state, provider: 'canva' }) : null;
    if (!pending || !q.code) return res.redirect(`${front}/settings/integrations?integration=canva&status=error&message=expired`);
    const s = await loadCanvaSettings();
    const tokens = await canvaExchangeCode(s, q.code, pending.codeVerifier, callbackUrl(req));
    await saveCanvaTokens(pending.userId, tokens);
    if (pending.returnTo) {
      const sep = pending.returnTo.includes('?') ? '&' : '?';
      return res.redirect(`${front}${pending.returnTo}${sep}canva=connected`);
    }
    res.redirect(`${front}/settings/integrations?integration=canva&status=success`);
  } catch (error) {
    console.error('[canva] callback failed:', error);
    res.redirect(`${front}/settings/integrations?integration=canva&status=error&message=server_error`);
  }
});

router.post('/disconnect', isAuthenticated, async (req: Request, res: Response) => {
  try {
    await clearCanvaTokens(req.user!._id);
    res.json({ success: true, message: 'Canva integration disconnected' });
  } catch (error) {
    fail(res, error, 'Failed to disconnect Canva');
  }
});

router.get('/state', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const s = await loadCanvaSettings();
    const c = req.user!.integrations?.canva;
    res.json({ success: true, available: s.ready, connected: s.ready && Boolean(c?.connected && String(c.accessToken || '').startsWith('g1:')) });
  } catch (error) {
    fail(res, error, 'Could not check Canva');
  }
});

// ---------------------------------------------------------------------------
// Edit in Canva
// ---------------------------------------------------------------------------

async function loadImage(url: string): Promise<Buffer> {
  const key = objectKeyFromUrl(url);
  return key ? getObjectBuffer(key, 40 * 1024 * 1024) : (await downloadImageFromUrl(url)).buffer;
}

router.post('/edits', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const s = await loadCanvaSettings();
    if (!s.ready) throw new PublishingError(409, 'Canva is not set up yet. A System Admin adds the Canva app keys in Settings › Integrations.');
    const target = req.body?.target === 'task' ? 'task' : 'library';
    let image: Buffer;
    let title: string;
    let ownerId: Id;
    let assetId: Id | undefined;
    let taskId: Id | undefined;
    let back: string;
    if (target === 'library') {
      const asset = await loadAccessibleAsset(req.user!, req.body?.assetId);
      const v = await LibraryVersion.findById(asset.currentVersionId);
      if (!v || !/^image\/(png|jpe?g|webp|gif|heic|tiff)$/.test(v.mime)) throw new PublishingError(400, 'Only pictures can be edited in Canva');
      image = await getObjectBuffer(v.s3Key, 40 * 1024 * 1024);
      title = asset.title;
      ownerId = asset.ownerId as Id;
      assetId = asset._id as Id;
      back = links.libraryItem(asset._id);
    } else {
      const { task, ownerId: owner } = await loadTaskForPublishing(req.user!, req.body?.taskId);
      if (!task.designedImage) throw new PublishingError(400, 'This task has no image yet');
      image = await loadImage(task.designedImage);
      title = task.name;
      ownerId = owner;
      taskId = task._id as Id;
      back = links.post(task._id);
    }
    const token = await canvaToken(req.user!);
    if (!token) {
      return res.status(409).json({ success: false, code: 'CANVA_NOT_CONNECTED', message: 'Connect your Canva account first', connectPath: `/integrations/canva?returnTo=${encodeURIComponent(back)}` });
    }
    // Canva takes PNG/JPEG reliably; convert anything else.
    const meta = await sharp(image).metadata();
    if (!['png', 'jpeg'].includes(meta.format || '')) image = await sharp(image).png().toBuffer();
    const canvaAsset = await canvaUploadAsset(token, image, title);
    const design = await canvaCreateDesign(token, canvaAsset, title, canvaDesignSize(meta.width, meta.height));
    const correlationState = crypto.randomBytes(18).toString('base64url');
    const edit = await CanvaEdit.create({ userId: req.user!._id, ownerId, target, assetId, taskId, designId: design.designId, editUrl: design.editUrl, correlationState });
    const url = new URL(design.editUrl);
    url.searchParams.set('correlation_state', correlationState);
    res.status(201).json({ success: true, editId: edit._id, editUrl: url.toString() });
  } catch (error) {
    fail(res, error, 'Could not open the picture in Canva');
  }
});

/** Open edits for a Library item or task ("Bring back from Canva"). */
router.get('/edits', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = { userId: req.user!._id, status: { $in: ['editing', 'importing', 'failed'] } };
    if (typeof req.query.assetId === 'string' && mongoose.isValidObjectId(req.query.assetId)) filter.assetId = req.query.assetId;
    else if (typeof req.query.taskId === 'string' && mongoose.isValidObjectId(req.query.taskId)) filter.taskId = req.query.taskId;
    else throw new PublishingError(400, 'Pass assetId or taskId');
    const edits = await CanvaEdit.find(filter).sort({ createdAt: -1 }).limit(5);
    res.json({ success: true, edits: edits.map((e) => ({ id: e._id, status: e.status, error: e.error || null, createdAt: e.createdAt, editUrl: e.editUrl })) });
  } catch (error) {
    fail(res, error, 'Could not load Canva edits');
  }
});

/** Canva's "Return to Blueprint" button lands here; send the user to the right page to import. */
router.get('/return', async (req: Request, res: Response) => {
  const front = getFrontendUrl();
  try {
    const { correlationState } = correlationFromJwt(String(req.query.correlation_jwt || ''));
    const edit = correlationState ? await CanvaEdit.findOne({ correlationState }) : null;
    if (!edit) return res.redirect(`${front}${links.library()}?canva=unknown`);
    const page = edit.target === 'task' ? links.post(edit.taskId) : links.libraryItem(edit.assetId);
    res.redirect(`${front}${page}?canvaEdit=${edit._id}`);
  } catch {
    res.redirect(`${front}${links.library()}`);
  }
});

/** Export the design from Canva and save it as the next version (Library) or the task image. */
router.post('/edits/:id/import', isAuthenticated, async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new PublishingError(400, 'Invalid edit');
    const edit = await CanvaEdit.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!edit) throw new PublishingError(404, 'Canva edit not found');
    const claimed = await CanvaEdit.findOneAndUpdate({ _id: edit._id, status: { $ne: 'importing' } }, { $set: { status: 'importing', error: null } });
    if (!claimed) throw new PublishingError(409, 'Already bringing this design back');
    try {
      const token = await canvaToken(req.user!);
      if (!token) throw new PublishingError(409, 'Reconnect your Canva account, then try again');
      const png = await canvaExportPng(token, edit.designId);
      if (edit.target === 'library') {
        const asset = await loadAccessibleAsset(req.user!, String(edit.assetId));
        const [result] = await ingest({
          ownerId: asset.ownerId as Id,
          userId: req.user!._id as Id,
          originalName: `${asset.title.replace(/[^\w\- ]+/g, '').slice(0, 60) || 'design'}-canva.png`,
          mime: 'image/png',
          data: { buffer: png },
          source: 'canva',
          targetAssetId: asset._id as Id,
          note: 'Edited in Canva'
        });
        if (result.status === 'failed' && !/already version/i.test(result.error || '')) throw new PublishingError(400, result.error || 'Could not save the design');
        const unchanged = result.status !== 'version_added';
        await CanvaEdit.updateOne({ _id: edit._id }, { $set: { status: 'imported', importedAt: new Date() } });
        return res.json({ success: true, unchanged, message: unchanged ? 'No changes since the last version' : `Saved as version ${result.versionNumber}`, assetId: asset._id });
      }
      const { task } = await loadTaskForPublishing(req.user!, String(edit.taskId));
      const url = await uploadBufferToS3(png, 'image/png', 'task-images');
      task.designedImage = url;
      task.lastModifiedBy = req.user!._id as Id;
      await task.save();
      void queueTaskImage(task.campaignId, task._id, url, req.user!._id, 'Edited in Canva');
      await CanvaEdit.updateOne({ _id: edit._id }, { $set: { status: 'imported', importedAt: new Date() } });
      res.json({ success: true, message: 'The task image was updated from Canva', imageUrl: url, taskId: task._id });
    } catch (error: any) {
      await CanvaEdit.updateOne({ _id: edit._id }, { $set: { status: 'failed', error: String(error?.message || 'Import failed').slice(0, 300) } });
      throw error;
    }
  } catch (error) {
    fail(res, error, 'Could not bring the design back from Canva');
  }
});

// ---------------------------------------------------------------------------
// Admin: Canva app keys
// ---------------------------------------------------------------------------

async function settingsPayload(req: Request) {
  const config = await AppConfig.getConfig();
  const s = await loadCanvaSettings();
  let hint = '';
  try {
    hint = maskSecret(decryptSecret(config.canvaClientSecretEnc));
  } catch {
    hint = '';
  }
  return {
    clientId: config.canvaClientId || '',
    secretHint: hint,
    ready: s.ready,
    source: s.source,
    callbackUrl: callbackUrl(req),
    returnUrl: returnUrl(req),
    developerPortal: 'https://www.canva.com/developers/integrations/connect-api'
  };
}

router.get('/settings', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, settings: await settingsPayload(req) });
  } catch (error) {
    fail(res, error, 'Could not load Canva settings');
  }
});

router.patch('/settings', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();
    if (typeof req.body?.clientId === 'string') config.canvaClientId = req.body.clientId.trim().slice(0, 200) || undefined;
    if (typeof req.body?.clientSecret === 'string' && req.body.clientSecret.trim()) config.canvaClientSecretEnc = encryptSecret(req.body.clientSecret.trim().slice(0, 500));
    if (req.body?.clearSecret === true) config.canvaClientSecretEnc = undefined;
    await config.save();
    res.json({ success: true, message: 'Canva settings saved', settings: await settingsPayload(req) });
  } catch (error) {
    fail(res, error, 'Could not save Canva settings');
  }
});

export default router;
