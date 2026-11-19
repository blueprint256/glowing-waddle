import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { Task } from '../models/Task';
import { UserRole } from '../models/User';
import { DesignJob } from '../models/DesignJob';
import type { IBrandKit } from '../models/BrandKit';
import { isAuthenticated } from '../middleware/auth';
import { canManageTasks, isSystemAdmin } from '../middleware/rbac';
import { checkTaskOwnership } from '../middleware/ownership';
import { validateMongoId } from '../middleware/validation';
import { assertAllowance } from '../services/aiAllowance';
import { AIError } from '../lib/aiError';
import { DesignError } from '../services/designPipeline';
import { editDesign, exportSizes, findDesign, printDesign } from '../services/designEdits';
import { applyPack, brandId, engineKit, loadBrandKit, mergeVersions, storeLogoFiles, syncCompanyLogo } from '../services/designBrand';
import { allDesigns } from '../services/designLibrary';
import { approveDesign, builtinTest, deleteDesignRecord, getRecord, retestDesign, retireDesign, reviseDesign, saveEditedDesign, startImport } from '../services/designImport';
import { DesignTemplateModel, type IDesignTemplate } from '../models/DesignTemplate';
import { BUILTIN_DESIGNS } from '../design/library';
import type { DesignTemplate } from '../design/types';
import { BRAND_PACKS, packById } from '../design/packs';
import { FONTS, FONT_DIR, FONT_CONTENT_TYPE, fontFormatOf, isCustomFontId } from '../design/fonts';
import { uploadBufferToS3, deleteFromS3, objectKeyFromUrl } from '../utils/s3Service';
import { FORMATS, isFormatId } from '../design/formats';
import { isHex } from '../design/color';

/**
 * Designed posters (docs/DESIGN_ENGINE.md):
 *   POST /api/design/tasks/:id/posters          start making poster options for a post
 *   GET  /api/design/jobs/:jobId                 progress of one
 *   GET  /api/design/tasks/:id/jobs/latest       the post's latest job (to pick up progress again)
 *   POST /api/design/tasks/:id/posters/:ref/edit type on the poster, or describe a change
 *   POST /api/design/tasks/:id/posters/:ref/print  A4/A3 PDF
 *   GET/PUT /api/design/brand-kit, logos, partners and fonts: the account's brand kit (Settings › Brand)
 *   GET  /api/design/catalog                     designs, packs, fonts and formats (for the screens)
 */

const router = express.Router();
type Id = mongoose.Types.ObjectId;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|svg\+xml)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Use a PNG, JPG, WebP or SVG file'));
  }
});
const uploadFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const message = (err as any)?.code === 'LIMIT_FILE_SIZE' ? 'That file is over 15 MB.' : (err as Error)?.message || 'Upload failed';
    res.status(400).json({ success: false, message });
  });

const fontUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });
const uploadFont = (req: Request, res: Response, next: NextFunction) =>
  fontUpload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const message = (err as any)?.code === 'LIMIT_FILE_SIZE' ? 'That font file is over 6 MB.' : (err as Error)?.message || 'Upload failed';
    res.status(400).json({ success: false, message });
  });

const FONT_CATEGORIES = ['sans', 'serif', 'display', 'condensed', 'script'] as const;

/** Reads weight and style from a font's file name ("Kawa-BoldItalic.ttf" → 700 italic). */
function faceFromName(fileName: string): { weight: string; style: 'normal' | 'italic' } {
  const n = fileName.toLowerCase().replace(/\.(ttf|otf|woff2?)$/, '');
  const style = /italic|oblique/.test(n) ? 'italic' : 'normal';
  if (/\[.*wght.*\]|variable|-vf\b/.test(n)) return { weight: '100 900', style };
  const table: [RegExp, string][] = [
    [/thin|hairline/, '100'],
    [/extra-?light|ultra-?light/, '200'],
    [/light/, '300'],
    [/medium/, '500'],
    [/semi-?bold|demi-?bold/, '600'],
    [/extra-?bold|ultra-?bold/, '800'],
    [/black|heavy/, '900'],
    [/bold/, '700']
  ];
  const hit = table.find(([re]) => re.test(n));
  return { weight: hit ? hit[1] : '400', style };
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof DesignError || error instanceof AIError) {
    const extra = error instanceof AIError && error.status === 429 ? { code: 'AI_DESIGN_LIMIT' } : {};
    return res.status(error.status).json({ success: false, message: error.message, ...extra });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim()).slice(0, max) : []);

function jobView(job: any) {
  return {
    id: String(job._id),
    taskId: String(job.taskId),
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    draftIds: job.draftIds || [],
    message: job.message || null,
    error: job.error || null,
    createdAt: job.createdAt
  };
}

// ---------------------------------------------------------------------------
// Posters
// ---------------------------------------------------------------------------

router.post('/tasks/:id/posters', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    await assertAllowance(req.user!, 'designs');
    const task = await Task.findById(req.params.id);
    if (!task) throw new DesignError(404, 'Post not found');
    const running = await DesignJob.findOne({ taskId: task._id, status: { $in: ['queued', 'running'] } });
    if (running) return res.json({ success: true, job: jobView(running), message: 'Already making posters for this post' });
    const kit = await loadBrandKit(task.ownerId);
    const body = req.body || {};
    const brief = str(body.brief) || task.description || '';
    if (!brief.trim() && !(task.content || '').trim()) throw new DesignError(400, 'Say what the poster is about first.');
    const photoUrls = body.photoUrls !== undefined ? strList(body.photoUrls, 6) : (task.references || []).filter((r) => r.role === 'include').map((r) => r.url).slice(0, 6);
    // Photos must be this post's own pictures or the account's files (never someone else's).
    const known = new Set([task.designedImage, ...(task.references || []).map((r) => r.url), ...(task.imageHistory || []).map((h) => h.url)].filter(Boolean) as string[]);
    for (const url of photoUrls) {
      if (!known.has(url) && !(await isOwnersLibraryFile(url, task.ownerId as Id))) throw new DesignError(400, 'One of the photos isn’t this account’s.');
    }
    const partnerIds = strList(body.partnerIds, 8).filter((id) => kit.partners.some((p) => p.id === id));
    const campaignLogoIds =
      body.campaignLogoIds !== undefined
        ? strList(body.campaignLogoIds, 3).filter((id) => kit.logos.some((l) => l.id === id && l.role === 'campaign'))
        : kit.logos.filter((l) => l.role === 'campaign' && l.always).map((l) => l.id);
    const job = await DesignJob.create({
      taskId: task._id,
      ownerId: task.ownerId,
      userId: req.user!._id,
      request: {
        brief,
        format: isFormatId(body.format) ? body.format : 'portrait',
        photoUrls,
        partnerIds,
        campaignLogoIds,
        count: Math.max(1, Math.min(4, Number(body.count) || 4)),
        designIds: strList(body.designIds, 20)
      }
    });
    res.status(202).json({ success: true, job: jobView(job), message: 'Making your poster options' });
  } catch (error) {
    fail(res, error, 'Couldn’t start the poster.');
  }
});

async function isOwnersLibraryFile(url: string, ownerId: Id): Promise<boolean> {
  const { objectKeyFromUrl } = await import('../utils/s3Service');
  const { LibraryVersion } = await import('../models/LibraryVersion');
  const key = objectKeyFromUrl(url);
  if (!key) return false;
  return !!(await LibraryVersion.exists({ s3Key: key, ownerId }));
}

router.get('/jobs/:jobId', isAuthenticated, validateMongoId('jobId'), async (req: Request, res: Response) => {
  try {
    const job = await DesignJob.findById(req.params.jobId);
    const mine = job && (req.user!.role === UserRole.SYSTEM_ADMIN || String(job.ownerId) === String(req.user!._id) || String(job.userId) === String(req.user!._id));
    if (!job || !mine) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, job: jobView(job) });
  } catch (error) {
    fail(res, error, 'Couldn’t read the poster’s progress.');
  }
});

router.get('/tasks/:id/jobs/latest', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const job = await DesignJob.findOne({ taskId: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, job: job ? jobView(job) : null });
  } catch (error) {
    fail(res, error, 'Couldn’t read the poster’s progress.');
  }
});

router.post('/tasks/:id/posters/:ref/edit', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) throw new DesignError(404, 'Post not found');
    const text = req.body?.text && typeof req.body.text === 'object' ? req.body.text : undefined;
    const request = str(req.body?.request, 1500) || undefined;
    const ops = Array.isArray(req.body?.ops) ? req.body.ops.slice(0, 10) : undefined;
    if (!text && !request && !ops?.length) throw new DesignError(400, 'Type on the poster or describe the change.');
    const answer = await editDesign(task, String(req.params.ref), { text, request, ops }, req.user!._id as Id);
    if (answer.draft) {
      task.lastModifiedBy = req.user!._id;
      await task.save();
    }
    res.json({ success: true, draft: answer.draft, reply: answer.reply, refused: answer.refused || null, message: answer.draft ? 'New version ready' : answer.reply });
  } catch (error) {
    fail(res, error, 'Couldn’t change the poster.');
  }
});

router.post('/tasks/:id/posters/:ref/print', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) throw new DesignError(404, 'Post not found');
    const size = req.body?.size === 'a3' ? 'a3' : 'a4';
    const ref = String(req.params.ref);
    const { design } = findDesign(task, ref);
    const cached = (design as any)[`pdf_${size}`];
    if (cached) return res.json({ success: true, url: cached });
    const url = await printDesign(task, ref, size);
    (design as any)[`pdf_${size}`] = url;
    if (ref === 'current') task.markModified('pictureDesign');
    else task.markModified('aiDrafts');
    await task.save();
    res.json({ success: true, url });
  } catch (error) {
    fail(res, error, 'Couldn’t make the print file.');
  }
});

/** The poster in every other social shape its design has (files to download, not drafts). */
router.post('/tasks/:id/posters/:ref/sizes', isAuthenticated, canManageTasks, validateMongoId('id'), checkTaskOwnership, async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) throw new DesignError(404, 'Post not found');
    const ref = String(req.params.ref);
    const result = await exportSizes(task, ref);
    if (ref === 'current') task.markModified('pictureDesign');
    else task.markModified('aiDrafts');
    await task.save();
    res.json({ success: true, ...result });
  } catch (error) {
    fail(res, error, 'Couldn’t make the other sizes.');
  }
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** The bundled open-licence font files, so the brand kit screen can show each font. */
router.use('/font-files', express.static(FONT_DIR, { maxAge: '30d', fallthrough: false, index: false }));

router.get('/catalog', isAuthenticated, async (_req: Request, res: Response) => {
  try {
    const designs = await allDesigns();
    res.json({
      success: true,
      designs: designs.map((d) => ({ id: d.id, name: d.name, description: d.description, tags: d.tags, formats: d.formats, fields: d.fields, photos: d.photos, sponsors: d.sponsors, background: d.background })),
      packs: BRAND_PACKS.map((p) => ({ id: p.id, name: p.name, colors: p.colors, fonts: p.fonts, rules: p.rules, palette: p.palette })),
      fonts: FONTS.map((f) => ({ id: f.id, family: f.family, category: f.category, note: f.note || null, faces: f.files.map((x) => ({ path: `/design/font-files/${x.file.split('/').map(encodeURIComponent).join('/')}`, style: x.style, weight: x.weight, stretch: x.stretch || null })) })),
      formats: Object.values(FORMATS).map((f) => ({ id: f.id, label: f.label, width: f.width, height: f.height, print: !!f.print }))
    });
  } catch (error) {
    fail(res, error, 'Couldn’t load the designs.');
  }
});

// ---------------------------------------------------------------------------
// Brand kit (the signed-in account's; admins may pass ?ownerId=)
// ---------------------------------------------------------------------------

function kitOwner(req: Request): Id {
  const asked = typeof req.query.ownerId === 'string' ? req.query.ownerId : null;
  if (asked && req.user!.role === UserRole.SYSTEM_ADMIN && mongoose.isValidObjectId(asked)) return new mongoose.Types.ObjectId(asked);
  return req.user!._id as Id;
}

function kitView(kit: IBrandKit) {
  const engine = engineKit(kit);
  return {
    name: kit.name,
    pack: kit.pack || null,
    colors: kit.colors,
    fonts: kit.fonts,
    customFonts: (kit.customFonts || []).map((f) => ({ id: f.id, name: f.name, category: f.category, files: f.files.map((x) => ({ url: x.url, style: x.style, weight: x.weight, format: x.format })) })),
    logos: kit.logos,
    partners: kit.partners,
    rules: kit.rules,
    notes: kit.notes || '',
    contact: { social: kit.contact?.social || '', web: kit.contact?.web || '' },
    /** What posters actually use: the pack's rules included. */
    effective: { colors: engine.colors, fonts: engine.fonts, rules: engine.rules }
  };
}

router.get('/brand-kit', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, kit: kitView(await loadBrandKit(kitOwner(req))) });
  } catch (error) {
    fail(res, error, 'Couldn’t load the brand kit.');
  }
});

router.put('/brand-kit', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const kit = await loadBrandKit(kitOwner(req));
    const b = req.body || {};
    if (typeof b.name === 'string') kit.name = b.name.trim().slice(0, 120);
    if (b.pack !== undefined && (b.pack || null) !== (kit.pack || null)) {
      if (b.pack && !packById(b.pack)) throw new DesignError(400, 'Unknown brand pack.');
      applyPack(kit, b.pack || null);
    }
    if (b.colors && typeof b.colors === 'object') {
      // A brand pack allows only its own palette (Rotary's brand centre colours, for example).
      const pack = packById(kit.pack);
      const allowed = pack ? new Set([...pack.palette, ...Object.values(pack.colors)].map((c) => c.hex.toLowerCase())) : null;
      for (const role of ['primary', 'secondary', 'accent', 'ink', 'paper'] as const) {
        const c = b.colors[role];
        if (!c) continue;
        if (!isHex(c.hex)) throw new DesignError(400, `The ${role} colour must be a hex value like #17458f.`);
        if (allowed && !allowed.has(c.hex.toLowerCase())) throw new DesignError(400, `${pack!.name}’s brand uses its own palette: choose one of its colours.`);
        (kit.colors as any)[role] = { name: str(c.name, 60) || (kit.colors as any)[role]?.name || role, hex: c.hex.toLowerCase() };
      }
      kit.markModified('colors');
    }
    // A brand pack's fonts are part of the brand: they change only by leaving the pack.
    if (b.fonts && typeof b.fonts === 'object' && !kit.pack) {
      const ok = (id: unknown) => typeof id === 'string' && (FONTS.some((f) => f.id === id) || (isCustomFontId(id) && (kit.customFonts || []).some((f) => f.id === id && f.files.length)));
      kit.fonts = { display: ok(b.fonts.display) ? b.fonts.display : kit.fonts.display, text: ok(b.fonts.text) ? b.fonts.text : kit.fonts.text, accent: ok(b.fonts.accent) ? b.fonts.accent : b.fonts.accent === null ? undefined : kit.fonts.accent };
    }
    if (typeof b.notes === 'string') kit.notes = b.notes.slice(0, 3000);
    if (b.contact && typeof b.contact === 'object') kit.contact = { social: str(b.contact.social, 60), web: str(b.contact.web, 60) };
    if (Array.isArray(b.rules)) {
      const admin = req.user!.role === UserRole.SYSTEM_ADMIN;
      // Rules an administrator made mandatory stay as they are unless an administrator changes them.
      const keptHard = admin ? [] : kit.rules.filter((r) => r.hard);
      const hardIds = new Set(keptHard.map((r) => r.id));
      const sent = b.rules
        .filter((r: any) => r && typeof r.text === 'string' && r.text.trim() && !hardIds.has(r.id))
        .map((r: any) => ({ id: typeof r.id === 'string' && r.id ? r.id : brandId(), text: r.text.trim().slice(0, 400), hard: admin ? !!r.hard : false }));
      kit.rules = [...keptHard, ...sent].slice(0, 30);
    }
    kit.updatedBy = req.user!._id;
    await kit.save();
    res.json({ success: true, kit: kitView(kit), message: 'Brand kit saved' });
  } catch (error) {
    fail(res, error, 'Couldn’t save the brand kit.');
  }
});

/** Upload a logo file: form fields file, role (primary|campaign), name, logoId (adds a version to it). */
router.post('/brand-kit/logos', isAuthenticated, canManageTasks, uploadFile, async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new DesignError(400, 'Choose a logo file.');
    const kit = await loadBrandKit(kitOwner(req));
    const files = await storeLogoFiles(req.file.buffer);
    const variant = files[0];
    const logoId = str(req.body?.logoId, 40);
    const existing = logoId ? kit.logos.find((l) => l.id === logoId) : null;
    const pack = packById(kit.pack);
    if (existing) {
      existing.variants = mergeVersions(existing.variants, files);
    } else {
      const role = req.body?.role === 'campaign' ? 'campaign' : 'primary';
      if (role === 'primary' && kit.logos.some((l) => l.role === 'primary')) {
        // One main logo: a new upload replaces it (its other versions go).
        kit.logos = kit.logos.filter((l) => l.role !== 'primary');
      }
      const d = role === 'primary' ? pack?.logoDefaults.primary : pack?.logoDefaults.campaign;
      kit.logos.push({
        id: brandId(),
        name: str(req.body?.name, 80) || (role === 'primary' ? 'Main logo' : 'Campaign logo'),
        role,
        variants: files,
        clearSpace: d?.clearSpace ?? 0.25,
        minHeight: d?.minHeight ?? 0.05,
        requiresPrimary: role === 'campaign' ? d?.requiresPrimary ?? true : undefined,
        always: false
      } as any);
    }
    kit.markModified('logos');
    await kit.save();
    await syncCompanyLogo(kit);
    const warning = variant.lowRes ? 'This file is small: it’s fine on social media but may look soft in print. Upload a larger PNG or an SVG if you have one.' : null;
    res.json({ success: true, kit: kitView(kit), warning, message: 'Logo added' });
  } catch (error) {
    fail(res, error, 'Couldn’t add the logo.');
  }
});

router.patch('/brand-kit/logos/:logoId', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const kit = await loadBrandKit(kitOwner(req));
    const logo = kit.logos.find((l) => l.id === req.params.logoId);
    if (!logo) throw new DesignError(404, 'Logo not found');
    const b = req.body || {};
    if (typeof b.name === 'string' && b.name.trim()) logo.name = b.name.trim().slice(0, 80);
    if (typeof b.always === 'boolean') logo.always = b.always;
    // Pack logos keep the pack's clear space and minimum size.
    if (!kit.pack) {
      if (typeof b.clearSpace === 'number' && b.clearSpace >= 0 && b.clearSpace <= 1) logo.clearSpace = b.clearSpace;
      if (typeof b.minHeight === 'number' && b.minHeight >= 0.02 && b.minHeight <= 0.3) logo.minHeight = b.minHeight;
    }
    if (typeof b.removeVariant === 'string') logo.variants = logo.variants.filter((v) => v.id !== b.removeVariant);
    const syncLogo = logo.role === 'primary' && (typeof b.removeVariant === 'string' || typeof b.variantId === 'string');
    if (typeof b.variantId === 'string' && ['color', 'reverse', 'mono-dark', 'mono-light'].includes(b.variant)) {
      const v = logo.variants.find((x) => x.id === b.variantId);
      if (v) v.variant = b.variant;
    }
    kit.markModified('logos');
    await kit.save();
    if (syncLogo) await syncCompanyLogo(kit);
    res.json({ success: true, kit: kitView(kit) });
  } catch (error) {
    fail(res, error, 'Couldn’t update the logo.');
  }
});

router.delete('/brand-kit/logos/:logoId', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const kit = await loadBrandKit(kitOwner(req));
    kit.logos = kit.logos.filter((l) => l.id !== req.params.logoId);
    kit.markModified('logos');
    await kit.save();
    await syncCompanyLogo(kit);
    res.json({ success: true, kit: kitView(kit) });
  } catch (error) {
    fail(res, error, 'Couldn’t remove the logo.');
  }
});

/** A partner (sponsor) logo kept in the kit for future posters: form fields file, name. */
router.post('/brand-kit/partners', isAuthenticated, canManageTasks, uploadFile, async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new DesignError(400, 'Choose the partner’s logo file.');
    const name = str(req.body?.name, 80);
    if (!name) throw new DesignError(400, 'Give the partner’s name.');
    const kit = await loadBrandKit(kitOwner(req));
    if (kit.partners.length >= 60) throw new DesignError(400, 'The kit holds up to 60 partners. Remove some first.');
    const [logo, ...alts] = await storeLogoFiles(req.file.buffer);
    kit.partners.push({ id: brandId(), name, logo, alts });
    kit.markModified('partners');
    await kit.save();
    const warning = logo.lowRes ? 'This logo file is small and may look soft in print.' : null;
    res.json({ success: true, kit: kitView(kit), warning, message: 'Partner added' });
  } catch (error) {
    fail(res, error, 'Couldn’t add the partner.');
  }
});

router.delete('/brand-kit/partners/:partnerId', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const kit = await loadBrandKit(kitOwner(req));
    kit.partners = kit.partners.filter((p) => p.id !== req.params.partnerId);
    kit.markModified('partners');
    await kit.save();
    res.json({ success: true, kit: kitView(kit) });
  } catch (error) {
    fail(res, error, 'Couldn’t remove the partner.');
  }
});

/**
 * Upload a font file (TTF, OTF, WOFF or WOFF2) the account has the right to use. Form fields: file,
 * name (the family, e.g. "Kawa Sans"), category, fontId (adds a weight or italic to that family).
 * Weight and italic are read from the file name and can be given as weight/style.
 */
router.post('/brand-kit/fonts', isAuthenticated, canManageTasks, uploadFont, async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new DesignError(400, 'Choose a font file.');
    const format = fontFormatOf(req.file.buffer);
    if (!format) throw new DesignError(400, 'That isn’t a font file. Use a TTF, OTF, WOFF or WOFF2 file.');
    const kit = await loadBrandKit(kitOwner(req));
    kit.customFonts = kit.customFonts || [];
    const b = req.body || {};
    const face = faceFromName(req.file.originalname || '');
    const weight = /^\d{3}( \d{3})?$/.test(String(b.weight || '')) ? String(b.weight) : face.weight;
    const style: 'normal' | 'italic' = b.style === 'italic' || b.style === 'normal' ? b.style : face.style;
    const url = await uploadBufferToS3(req.file.buffer, FONT_CONTENT_TYPE[format], 'brand-fonts');
    const file = { url, style, weight, format, bytes: req.file.size };
    const fontId = str(b.fontId, 40);
    let font = fontId ? kit.customFonts.find((f) => f.id === fontId) : undefined;
    if (fontId && !font) throw new DesignError(404, 'Font not found');
    if (font) {
      if (font.files.length >= 12) throw new DesignError(400, 'A font holds up to 12 files.');
      font.files = [...font.files.filter((f) => !(f.weight === weight && f.style === style)), file];
    } else {
      if (kit.customFonts.length >= 10) throw new DesignError(400, 'You can upload up to 10 fonts. Remove one first.');
      const name = str(b.name, 60) || (req.file.originalname || 'My font').replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_](thin|light|regular|medium|semibold|bold|extrabold|black|italic|variable|vf).*$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 60) || 'My font';
      const category = (FONT_CATEGORIES as readonly string[]).includes(b.category) ? b.category : 'sans';
      font = { id: `custom-${brandId()}`, name, category, files: [file] } as any;
      kit.customFonts.push(font!);
    }
    kit.markModified('customFonts');
    await kit.save();
    res.json({ success: true, kit: kitView(kit), fontId: font!.id, message: `${font!.name} added` });
  } catch (error) {
    fail(res, error, 'Couldn’t add the font.');
  }
});

/** One file of an uploaded font, for showing it on screen (signed-in, the account's own). */
router.get('/brand-kit/fonts/:fontId/files/:index', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const kit = await loadBrandKit(kitOwner(req));
    const font = (kit.customFonts || []).find((f) => f.id === req.params.fontId);
    const file = font?.files[Number(req.params.index)];
    if (!file) throw new DesignError(404, 'Font not found');
    const { loadPicture } = await import('../services/postPicture');
    const { buffer } = await loadPicture(file.url);
    res.setHeader('Content-Type', FONT_CONTENT_TYPE[file.format] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
  } catch (error) {
    fail(res, error, 'Couldn’t load the font.');
  }
});

/** Removes an uploaded font (or one of its files, with ?file=<url>). Posters using it go back to the default. */
router.delete('/brand-kit/fonts/:fontId', isAuthenticated, canManageTasks, async (req: Request, res: Response) => {
  try {
    const kit = await loadBrandKit(kitOwner(req));
    const font = (kit.customFonts || []).find((f) => f.id === req.params.fontId);
    if (!font) throw new DesignError(404, 'Font not found');
    const only = typeof req.query.file === 'string' ? req.query.file : null;
    const gone = only ? font.files.filter((f) => f.url === only) : font.files;
    font.files = only ? font.files.filter((f) => f.url !== only) : [];
    if (!font.files.length) {
      kit.customFonts = kit.customFonts.filter((f) => f.id !== font.id);
      for (const k of ['display', 'text', 'accent'] as const) {
        if (kit.fonts[k] === font.id) (kit.fonts as any)[k] = k === 'accent' ? undefined : k === 'display' ? 'opensans' : 'gelasio';
      }
      kit.markModified('fonts');
    }
    kit.markModified('customFonts');
    await kit.save();
    // Posters already made keep their pictures; the files are only needed for new ones and edits.
    for (const f of gone) {
      const key = objectKeyFromUrl(f.url);
      if (key) await deleteFromS3(key).catch(() => undefined);
    }
    res.json({ success: true, kit: kitView(kit) });
  } catch (error) {
    fail(res, error, 'Couldn’t remove the font.');
  }
});

// ---------------------------------------------------------------------------
// Design library (system admins): import from a reference, change, test, approve, retire
// ---------------------------------------------------------------------------

const referenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Use a PNG, JPG or WebP picture of the poster'));
  }
});

function recordView(r: IDesignTemplate) {
  const t = (r.template || {}) as DesignTemplate;
  return {
    id: String(r._id),
    designId: r.designId,
    status: r.status,
    source: 'imported' as const,
    name: t.name || 'New design',
    description: t.description || '',
    formats: t.formats || [],
    version: t.version || 1,
    test: r.test || null,
    previews: r.previews || [],
    notes: r.notes || '',
    sourceNote: r.sourceNote || '',
    message: r.message || null,
    error: r.error || null,
    cost: Math.round((r.cost || 0) * 100) / 100,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt
  };
}

/**
 * The poster engine's health for admins (Settings › AI and the connector): the Claude key the art
 * director needs, the renderer, cut-outs, the models used for each step and the design library.
 */
router.get('/admin/status', isAuthenticated, isSystemAdmin, async (_req: Request, res: Response) => {
  try {
    const { getProviderKey } = await import('../services/llmService');
    let anthropic = false;
    try {
      anthropic = Boolean(await getProviderKey('anthropic'));
    } catch {
      anthropic = false;
    }
    const [{ rendererStatus }, { cutoutAvailable }, { DESIGN_MODELS }] = await Promise.all([import('../design/renderer'), import('../services/cutout'), import('../design/claude')]);
    const renderer = await rendererStatus();
    const records = await DesignTemplateModel.find().select('status').lean();
    const count = (s: string) => records.filter((r: any) => r.status === s).length;
    const problems: string[] = [];
    if (!anthropic) problems.push('No Anthropic (Claude) key: posters are laid out without the art director, the review and described edits. Add the key in Settings › AI.');
    if (!renderer.ok) problems.push(`The poster renderer can’t start: ${renderer.error || 'unknown error'}`);
    res.json({
      success: true,
      ready: anthropic && renderer.ok,
      anthropic,
      renderer,
      cutouts: cutoutAvailable(),
      models: { art_director: DESIGN_MODELS.director, review: DESIGN_MODELS.critic, quick_edits: DESIGN_MODELS.quick, design_import: DESIGN_MODELS.importer },
      designs: { built_in: BUILTIN_DESIGNS.length, imported_live: count('live'), waiting_for_approval: count('draft'), retired: count('retired') },
      problems
    });
  } catch (error) {
    fail(res, error, 'Couldn’t check the poster engine.');
  }
});

router.get('/admin/designs', isAuthenticated, isSystemAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await DesignTemplateModel.find({}).sort({ updatedAt: -1 });
    res.json({
      success: true,
      builtin: BUILTIN_DESIGNS.map((d) => ({ id: d.id, designId: d.id, status: 'builtin', source: 'builtin', name: d.name, description: d.description, formats: d.formats, version: d.version })),
      imported: rows.map(recordView)
    });
  } catch (error) {
    fail(res, error, 'Couldn’t load the designs.');
  }
});

router.get('/admin/designs/builtin/:designId/test', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...((await builtinTest(String(req.params.designId))) as object) });
  } catch (error) {
    fail(res, error, 'Couldn’t test the design.');
  }
});

router.post(
  '/admin/designs/import',
  isAuthenticated,
  isSystemAdmin,
  (req: Request, res: Response, next: NextFunction) =>
    referenceUpload.single('file')(req, res, (err: unknown) =>
      err ? res.status(400).json({ success: false, message: (err as any)?.code === 'LIMIT_FILE_SIZE' ? 'That picture is over 20 MB.' : (err as Error).message }) : next()
    ),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) throw new DesignError(400, 'Choose a picture of the reference poster.');
      if (req.body?.rights !== 'yes') throw new DesignError(400, 'Confirm that the reference is only a layout reference: its artwork, logos, photos and words won’t be copied.');
      const record = await startImport({ image: req.file.buffer, note: str(req.body?.note, 2000), name: str(req.body?.name, 60) }, req.user!._id as Id);
      res.status(202).json({ success: true, design: recordView(record), message: 'Designing from the reference: this takes a few minutes' });
    } catch (error) {
      fail(res, error, 'Couldn’t start the import.');
    }
  }
);

router.get('/admin/designs/:id', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const record = await getRecord(String(req.params.id));
    res.json({ success: true, design: recordView(record), template: record.template || null });
  } catch (error) {
    fail(res, error, 'Couldn’t load the design.');
  }
});

/** Edited code or settings (the whole design as JSON): checked and tested now. */
router.put('/admin/designs/:id', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const record = await getRecord(String(req.params.id));
    if (!req.body?.template || typeof req.body.template !== 'object') throw new DesignError(400, 'Send the whole design.');
    await saveEditedDesign(record, req.body.template);
    res.json({ success: true, design: recordView(record), template: record.template, message: record.test?.failed ? 'Saved; some cases still fail' : 'Saved and passing' });
  } catch (error) {
    fail(res, error, 'Couldn’t save the design.');
  }
});

router.post('/admin/designs/:id/revise', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const request = str(req.body?.request, 1500);
    if (!request) throw new DesignError(400, 'Describe the change.');
    const record = await getRecord(String(req.params.id));
    await reviseDesign(record, request, req.user!._id as Id);
    res.status(202).json({ success: true, design: recordView(record), message: 'Making the change' });
  } catch (error) {
    fail(res, error, 'Couldn’t start the change.');
  }
});

router.post('/admin/designs/:id/test', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const record = await getRecord(String(req.params.id));
    await retestDesign(record);
    res.json({ success: true, design: recordView(record) });
  } catch (error) {
    fail(res, error, 'Couldn’t test the design.');
  }
});

router.post('/admin/designs/:id/approve', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const record = await getRecord(String(req.params.id));
    await approveDesign(record, req.user!._id as Id);
    res.json({ success: true, design: recordView(record), message: 'Design approved: posters can use it now' });
  } catch (error) {
    fail(res, error, 'Couldn’t approve the design.');
  }
});

router.post('/admin/designs/:id/retire', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const record = await getRecord(String(req.params.id));
    await retireDesign(record);
    res.json({ success: true, design: recordView(record), message: 'Design retired: new posters won’t use it' });
  } catch (error) {
    fail(res, error, 'Couldn’t retire the design.');
  }
});

router.delete('/admin/designs/:id', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const record = await getRecord(String(req.params.id));
    await deleteDesignRecord(record);
    res.json({ success: true, message: 'Design deleted' });
  } catch (error) {
    fail(res, error, 'Couldn’t delete the design.');
  }
});

export default router;
