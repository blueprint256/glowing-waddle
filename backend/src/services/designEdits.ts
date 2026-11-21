import mongoose from 'mongoose';
import sharp from 'sharp';
import type { ITask, PostAIDraft, PostDesign } from '../models/Task';
import { getProviderKey, renderImage } from './llmService';
import { loadPicture } from './postPicture';
import { addDraft, newId } from './posts';
import { engineKit, loadBrandKit } from './designBrand';
import { DesignError, logUsage, preparePhotos } from './designPipeline';
import { cutout } from './cutout';
import { uploadBufferToS3 } from '../utils/s3Service';
import { renderDesign } from '../design/renderer';
import { applyEdits, applyTextEdits, editPrompt, EDIT_SYSTEM, EDIT_TOOL, type EditOp, type TextEdits } from '../design/edits';
import { callClaudeTool, DESIGN_MODELS } from '../design/claude';
import { editableAreas, hasErrors } from '../design/checks';
import { CONCEPT_SIZE, POSTER_ASPECT, brandColors, keepGutters, placeFromCrop, repairScene, separateText, templateForDoc, type Box, type PhotoLayer, type SceneDoc } from '../design/scene';
import type { BrandKit, FormatId } from '../design/types';

/**
 * Changing a designed poster (a scene): typing on the poster, one-tap buttons (bigger headline,
 * photo zoom, fade, shape, swap photo…) or a change described in words (a quick model turns it into
 * the same operations). The poster is drawn again from its scene in seconds and arrives as a new
 * draft next to the original, so nothing is lost.
 */

type Id = mongoose.Types.ObjectId;

const loader = async (url: string) => (await loadPicture(url)).buffer;

/** "current" is the post's picture; anything else is a draft id. */
export function findDesign(task: ITask, ref: string): { design: PostDesign; draft?: PostAIDraft } {
  if (ref === 'current') {
    if (!task.pictureDesign?.doc) throw new DesignError(400, 'The post’s picture isn’t a designed poster.');
    return { design: task.pictureDesign };
  }
  const draft = (task.aiDrafts || []).find((d) => d.id === ref);
  if (!draft?.design?.doc) throw new DesignError(404, 'That poster option is no longer here.');
  return { design: draft.design, draft };
}

function sceneDocOf(design: PostDesign): SceneDoc {
  const doc = JSON.parse(JSON.stringify(design.doc)) as SceneDoc;
  if (!doc.scene || doc.scene.version !== 2) throw new DesignError(400, 'This poster was made by the old design library and can’t be changed here. Make a new poster for this post.');
  return doc;
}

export interface EditRequest {
  text?: TextEdits;
  request?: string;
  ops?: EditOp[];
}

/** The operations the app's buttons may send directly (no AI). */
const QUICK_OPS = new Set(['headline_size', 'swap_colours', 'change_format', 'remove_sponsor', 'photo_zoom', 'photo_move', 'photo_fade', 'photo_tint', 'photo_shape', 'photo_breakout', 'swap_photo', 'set_backdrop']);

export interface EditAnswer {
  draft: PostAIDraft | null;
  reply: string;
  refused?: string;
}

async function anthropicKey(): Promise<string | null> {
  try {
    return await getProviderKey('anthropic');
  } catch {
    return null;
  }
}

const RELAYOUT_TOOL = {
  name: 'relayout',
  description: 'New positions for every layer on the new canvas.',
  schema: {
    type: 'object',
    required: ['layers'],
    properties: {
      layers: { type: 'array', items: { type: 'object', required: ['id', 'x', 'y', 'w', 'h'], properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } } }
    }
  }
};

/**
 * The poster for another shape. Close shapes are fitted in code; a very different one (a portrait
 * poster as a landscape banner) is laid out again by a quick model (about a third of a cent), each
 * photo keeping the part it showed. Without a key, the code fit is used and the checks decide.
 */
export async function docForFormat(doc: SceneDoc, format: FormatId, userId?: Id): Promise<SceneDoc> {
  const next: SceneDoc = { ...JSON.parse(JSON.stringify(doc)), format };
  const target = POSTER_ASPECT[format] || 0.8;
  const ratio = Math.max(target, next.scene.aspect) / Math.min(target, next.scene.aspect);
  if (ratio < 1.2) return next;
  const apiKey = await anthropicKey();
  if (!apiKey) return next;
  const s = next.scene;
  const r = (v: number) => Math.round(v * 10) / 10;
  const layers = s.layers.map((l) => {
    const b: Box = l.type === 'photo' ? l.frame : l.box;
    return { id: l.id, type: l.type, role: l.type === 'text' ? l.role : undefined, x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) };
  });
  const started = Date.now();
  try {
    const res = await callClaudeTool<{ layers: { id: string; x: number; y: number; w: number; h: number }[] }>({
      apiKey,
      model: DESIGN_MODELS.quick,
      system:
        'You lay a finished poster out again for a different shape, like a designer adapting a campaign: the same layers, the same hierarchy and style, rearranged to suit the new canvas (side by side when it is wide, stacked when it is tall). Positions are % of the canvas width (x, w) and height (y, h). Words and logos stay at least 5% from every edge and never overlap each other; photos and colour blocks may bleed off the edges. Keep text boxes about as large relative to the shorter side as before. Return every layer.',
      prompt: `Old canvas: width / height = ${r(s.aspect)}. New canvas: width / height = ${r(target)} (${format}).\nLayers (back to front):\n${JSON.stringify(layers)}\nWords: ${JSON.stringify(next.text)}`,
      tool: RELAYOUT_TOOL,
      maxTokens: 2000
    });
    if (userId) await logUsage(userId, 'Design · new shape', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - started);
    const byId = new Map((res.input.layers || []).map((l) => [l.id, l]));
    for (const l of s.layers) {
      const b = byId.get(l.id);
      if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite)) continue;
      const box = { x: b.x, y: b.y, w: Math.max(2, b.w), h: Math.max(2, b.h) };
      if (l.type === 'photo') {
        const p = next.photos[l.photo];
        // The part of the photo it showed stays shown.
        const old = l.place || (p ? placeFromCrop(l.frame, s.aspect, p, l.crop) : null);
        const crop = old ? { x: Math.max(0, (l.frame.x - old.x) / old.w), y: Math.max(0, (l.frame.y - old.y) / old.h), w: Math.min(1, l.frame.w / old.w) } : undefined;
        l.frame = box;
        l.crop = crop;
        l.place = p ? placeFromCrop(box, target, p, crop) : undefined;
      } else l.box = box;
    }
    s.aspect = target;
    separateText(s);
    keepGutters(s);
  } catch (error: any) {
    if (userId) await logUsage(userId, 'Design · new shape', `anthropic/${DESIGN_MODELS.quick}`, { input: 0, output: 0 }, 0, Date.now() - started, false, error?.message);
  }
  return next;
}

/** A new backdrop picture (no words, logos or people) for a scene. */
async function newBackdrop(prompt: string, kit: BrandKit, format: FormatId, userId: Id): Promise<{ url: string; width: number; height: number }> {
  const size = CONCEPT_SIZE[format] || '1024x1536';
  const c = brandColors(kit);
  const full = `${prompt.trim()}\nA poster background in the colours ${c.primary}, ${c.secondary} and ${c.accent}, with calm areas for words. Absolutely no text, letters, numbers, logos, people, watermarks or frames.`;
  const raw = await renderImage({ prompt: full, size, purpose: 'create', userId, promptName: 'Design · backdrop', use: 'design' });
  const jpeg = await sharp(raw).jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  return { url: await uploadBufferToS3(jpeg, 'image/jpeg', 'design-backgrounds'), width: meta.width || 1024, height: meta.height || 1536 };
}

export async function editDesign(task: ITask, ref: string, edit: EditRequest, userId: Id): Promise<EditAnswer> {
  const { design, draft: source } = findDesign(task, ref);
  let doc = sceneDocOf(design);
  const kit = engineKit(await loadBrandKit(task.ownerId));
  let reply = 'Done.';
  let refused: string | undefined;
  const ops: EditOp[] = [];

  if (edit.text && Object.keys(edit.text).length) doc = applyTextEdits(doc, edit.text);
  if (Array.isArray(edit.ops)) ops.push(...edit.ops.filter((o: any) => o && QUICK_OPS.has(o.op)).slice(0, 10));

  if (edit.request?.trim()) {
    const apiKey = await anthropicKey();
    if (!apiKey) throw new DesignError(400, 'Describing changes needs an Anthropic key (Settings › AI). You can still type on the poster and use the buttons.');
    const started = Date.now();
    const res = await callClaudeTool<{ ops: EditOp[]; reply: string }>({
      apiKey,
      model: DESIGN_MODELS.quick,
      system: EDIT_SYSTEM,
      prompt: editPrompt(doc, edit.request.slice(0, 1500), kit.rules.filter((r) => r.hard).map((r) => r.text)),
      tool: EDIT_TOOL,
      maxTokens: 1500
    });
    await logUsage(userId, 'Design · change', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - started);
    ops.push(...(res.input.ops || []));
    if (typeof res.input.reply === 'string' && res.input.reply.trim()) reply = res.input.reply.trim().slice(0, 300);
  }

  const formatBefore = doc.format;
  if (ops.length) {
    const applied = applyEdits(doc, ops);
    refused = applied.refused;
    if (!applied.changed.length && !edit.text) return { draft: null, reply: refused || 'That change isn’t possible with this poster.', refused };
    doc = applied.doc;
    // A photo swapped in: loaded, placed in the same frame around its subject.
    if (applied.swap) {
      // Only the post's own pictures can go into its poster.
      const own = new Set([task.designedImage, ...(task.references || []).map((r) => r.url), ...(task.imageHistory || []).map((h) => h.url), ...doc.photos.map((p) => p.url)].filter(Boolean) as string[]);
      if (!own.has(applied.swap.url)) throw new DesignError(400, 'Only this post’s own pictures can go into its poster.');
      const layer = doc.scene.layers.find((l): l is PhotoLayer => l.type === 'photo' && l.id === applied.swap!.layer);
      const [photo] = await preparePhotos([applied.swap.url]).catch(() => []);
      if (!layer || !photo) throw new DesignError(400, 'That photo couldn’t be loaded.');
      const shared = doc.scene.layers.filter((l) => l.type === 'photo' && l.photo === layer.photo).length > 1;
      if (shared) {
        doc.photos.push(photo.slot);
        layer.photo = doc.photos.length - 1;
      } else doc.photos[layer.photo] = photo.slot;
      layer.crop = undefined;
      layer.place = placeFromCrop(layer.frame, doc.scene.aspect, photo.slot);
      layer.breakout = null;
    }
    // People over the frame: their cut-out (cached per photo).
    for (const id of applied.needCutouts || []) {
      const layer = doc.scene.layers.find((l): l is PhotoLayer => l.type === 'photo' && l.id === id);
      const slot = layer && doc.photos[layer.photo];
      if (!layer || !slot) continue;
      const c = await cutout((await loadPicture(slot.url)).buffer, (png) => uploadBufferToS3(png, 'image/png', 'design-cutouts'), { subject: layer.subject, userId });
      if (c) slot.cutout = { url: c.url, width: c.width, height: c.height, edges: c.edges, box: c.box };
      else {
        layer.breakout = null;
        reply = 'The people couldn’t be cut out of this photo (cut-outs need the fal.ai key or a cut-out model), so the frame stays as it was.';
      }
    }
    if (applied.backdropPrompt) {
      const art = await newBackdrop(applied.backdropPrompt, kit, doc.format, userId);
      doc.background = { ...art, prompt: applied.backdropPrompt };
      doc.scene.backdrop = { kind: 'art' };
    }
  }
  if (doc.format !== formatBefore) doc = await docForFormat({ ...doc, format: formatBefore }, doc.format, userId);

  const draft = await renderAndKeep(task, doc, kit, { prompt: edit.request || 'Edited on the poster', from: source ? source.url : task.designedImage || undefined, why: design.why });
  return { draft, reply, refused };
}

/** Draws a scene doc (repairing once if the checks find something) and adds it as a draft. */
async function renderAndKeep(task: ITask, doc0: SceneDoc, kit: BrandKit, o: { prompt: string; from?: string; why?: string }): Promise<PostAIDraft> {
  let doc = doc0;
  let result = await renderDesign(templateForDoc(doc)!, doc, kit, loader, { type: 'jpeg', quality: 90 });
  if (hasErrors(result.report.issues)) {
    const fixed = repairScene(doc.scene, result.report.issues, doc.photos);
    if (fixed) {
      separateText(fixed);
      keepGutters(fixed);
      const again: SceneDoc = { ...doc, scene: fixed, text: fixed.copy };
      const r2 = await renderDesign(templateForDoc(again)!, again, kit, loader, { type: 'jpeg', quality: 90 });
      if (!hasErrors(r2.report.issues)) {
        doc = again;
        result = r2;
      }
    }
  }
  if (hasErrors(result.report.issues)) {
    const first = result.report.issues.find((i) => i.level === 'error')!;
    throw new DesignError(422, `${first.message} Try fewer words or another change.`);
  }
  const url = await uploadBufferToS3(result.file, 'image/jpeg', 'post-pictures');
  const draft: PostAIDraft = {
    id: newId(),
    url,
    kind: 'design',
    prompt: o.prompt.slice(0, 4000),
    from: o.from,
    size: doc.format,
    at: new Date(),
    design: { doc, issues: result.report.issues.map((i) => ({ level: i.level, code: i.code, message: i.message })), why: o.why, areas: editableAreas(result.report) }
  };
  addDraft(task, draft);
  return draft;
}

/** A print-ready PDF (A4 or A3) of a designed poster; text stays sharp at any size. */
export async function printDesign(task: ITask, ref: string, size: 'a4' | 'a3'): Promise<string> {
  const { design } = findDesign(task, ref);
  const doc = await docForFormat(sceneDocOf(design), size, task.ownerId as Id);
  const kit = engineKit(await loadBrandKit(task.ownerId));
  const result = await renderDesign(templateForDoc(doc)!, doc, kit, loader, { type: 'pdf' });
  if (hasErrors(result.report.issues)) throw new DesignError(422, 'The poster doesn’t fit the print size as it is. Try fewer words.');
  return uploadBufferToS3(result.file, 'application/pdf', 'post-prints');
}

/** The same poster in the other social shapes (feed, story, landscape), each checked; shapes the
 *  words don't fit are skipped with the reason. Not drafts: files to download. */
export async function exportSizes(task: ITask, ref: string): Promise<{ sizes: { format: FormatId; url: string }[]; skipped: { format: FormatId; reason: string }[] }> {
  const { design } = findDesign(task, ref);
  const base = sceneDocOf(design);
  const kit = engineKit(await loadBrandKit(task.ownerId));
  const cached: Record<string, string> = (design as any).sizes || {};
  const sizes: { format: FormatId; url: string }[] = [];
  const skipped: { format: FormatId; reason: string }[] = [];
  for (const format of ['square', 'portrait', 'story', 'landscape'] as FormatId[]) {
    if (format === base.format) continue;
    if (cached[format]) {
      sizes.push({ format, url: cached[format] });
      continue;
    }
    let doc = await docForFormat(base, format, task.ownerId as Id);
    let result = await renderDesign(templateForDoc(doc)!, doc, kit, loader, { type: 'jpeg' });
    if (hasErrors(result.report.issues)) {
      const fixed = repairScene(doc.scene, result.report.issues, doc.photos);
      if (fixed) {
        separateText(fixed);
        keepGutters(fixed);
        doc = { ...doc, scene: fixed, text: fixed.copy };
        result = await renderDesign(templateForDoc(doc)!, doc, kit, loader, { type: 'jpeg' });
      }
    }
    const errors = result.report.issues.filter((i) => i.level === 'error');
    if (errors.length) {
      skipped.push({ format, reason: errors[0].message });
      continue;
    }
    const url = await uploadBufferToS3(result.file, 'image/jpeg', 'post-prints');
    cached[format] = url;
    sizes.push({ format, url });
  }
  (design as any).sizes = cached;
  return { sizes, skipped };
}
