import sharp from 'sharp';
import mongoose from 'mongoose';
import { renderImage } from './llmService';
import { uploadBufferToS3 } from '../utils/s3Service';
import { cutout } from './cutout';
import { callClaudeTool, DESIGN_MODELS, type ClaudeImage } from '../design/claude';
import { brandText } from '../design/brief';
import {
  ART_DIRECTOR_SYSTEM,
  ART_DIRECTOR_TOOL,
  BACKDROP_PROMPT,
  CONCEPT_SIZE,
  SCENE_READER_SYSTEM,
  SCENE_TOOL,
  brandColors,
  cleanScene,
  conceptPrompt,
  sceneDoc,
  sceneReaderPrompt,
  sceneTemplate,
  artDirectorPrompt,
  designSeed,
  directionFromSeed,
  type DesignSeed,
  type PhotoLayer,
  type Scene,
  type SceneDoc
} from '../design/scene';
import { organicMask, refinePlace } from '../design/sceneFit';
import { keepGutters, keepPeopleInFrame } from '../design/scene';
import type { BrandKit, DesignTemplate, FormatId, PhotoSlot, SponsorSlot } from '../design/types';

type Id = mongoose.Types.ObjectId;

/**
 * Poster options as scenes (design/scene.ts). For each option, side by side:
 *  1. the image model designs a concept with the real photos (Settings › AI › Posters model);
 *  2. Claude reads it into a scene: layers, photo treatments, brand colours, the real words;
 *  3. only if the scene keeps the concept's art: one edit removes its words, logos and photos;
 *  4. the engine fits each real photo where the concept drew it (no AI), traces organic frames,
 *     and cuts out the people who break out of a frame (SAM 3, once per photo, cached).
 * About 4–7 US cents per option. An option whose concept or reading fails is left out.
 */

export interface SceneInput {
  brief: string;
  caption: string;
  kit: BrandKit;
  format: FormatId;
  photos: { slot: PhotoSlot; buffer: Buffer; description?: string }[];
  sponsors: SponsorSlot[];
  campaignLogoIds: string[];
  voice: { sector?: string; tone?: string } | null;
  count: number;
  /** The art direction for each option, written for this poster (design/scene.ts). */
  directions: { name: string; direction: string }[];
  apiKey: string;
  userId: Id;
  today?: Date;
  log: (name: string, model: string, usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }, cost: number, ms: number, ok?: boolean, error?: string) => Promise<void>;
}

export interface SceneOption {
  doc: SceneDoc;
  design: DesignTemplate;
  why: string;
  conceptUrl?: string;
}

async function small(buffer: Buffer, size = 1024): Promise<ClaudeImage> {
  const jpeg = await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: size, height: size, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
  return { mediaType: 'image/jpeg', base64: jpeg.toString('base64') };
}

const storeCutout = (png: Buffer) => uploadBufferToS3(png, 'image/png', 'design-cutouts');

/** One option, from concept to a design ready to render. Null when the concept or reading fails. */
async function oneScene(input: SceneInput, index: number): Promise<SceneOption | null> {
  const { kit, format } = input;
  const size = CONCEPT_SIZE[format] || '1024x1536';
  const [cw, ch] = size.split('x').map(Number);
  const aspect = cw / ch;
  const refs = input.photos.slice(0, 3);
  const details = (input.brief.match(/\b(date|time|place|where|when)\s*:|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\d{1,2}(:\d{2})?\s*(am|pm)/gim) || []).length;
  const brief = input.directions[index % input.directions.length];

  // 1) The concept.
  let t0 = Date.now();
  let concept: Buffer;
  try {
    const prompt = conceptPrompt({
      brief: input.brief,
      brandName: kit.name,
      sector: input.voice?.sector,
      colors: brandColors(kit),
      mood: input.voice?.tone,
      format,
      words: { headline: true, subhead: true, details: Math.max(1, Math.min(3, details || 2)), cta: true },
      partners: input.sponsors.length,
      otherLogos: input.campaignLogoIds.length,
      photos: refs.length,
      direction: brief.direction
    });
    const images = await Promise.all(
      refs.map(async (p, i) => ({ buffer: await sharp(p.buffer).rotate().resize({ width: 1024, height: 1024, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer(), name: `photo-${i + 1}.jpg`, contentType: 'image/jpeg' }))
    );
    // No fidelity lock: the concept's pixels are never used (the engine draws the real photo), and
    // asking the model to reproduce the photograph exactly makes it place the photo instead of
    // designing around it.
    concept = await renderImage({ prompt, images, size, userId: input.userId, promptName: 'Design · concept', use: 'design' });
    concept = await sharp(concept).resize(cw, ch, { fit: 'fill' }).png().toBuffer();
  } catch (error: any) {
    console.error('[design] Concept failed:', error?.message);
    return null;
  }
  const conceptUrl = await uploadBufferToS3(await sharp(concept).jpeg({ quality: 85 }).toBuffer(), 'image/jpeg', 'design-backgrounds').catch(() => undefined);

  // 2) The reading.
  t0 = Date.now();
  let scene: Scene;
  try {
    const images: ClaudeImage[] = [{ ...(await small(concept)), label: 'The concept:' }];
    for (const [i, p] of refs.entries()) images.push({ ...(await small(p.buffer, 768)), label: `Real photo ${i + 1}:` });
    const res = await callClaudeTool<any>({
      apiKey: input.apiKey,
      model: DESIGN_MODELS.director,
      system: SCENE_READER_SYSTEM,
      context: brandText(kit),
      prompt: sceneReaderPrompt({ brief: input.brief, brand: '', partners: input.sponsors.map((s) => s.name || 'partner'), otherLogos: input.campaignLogoIds.length, photos: refs.length, format, today: input.today }),
      images,
      tool: SCENE_TOOL,
      maxTokens: 4000
    });
    await input.log('Design · scene reading', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - t0);
    scene = cleanScene(res.input, { partners: input.sponsors.length, photos: refs.length, aspect });
  } catch (error: any) {
    await input.log('Design · scene reading', `anthropic/${DESIGN_MODELS.director}`, { input: 0, output: 0 }, 0, Date.now() - t0, false, error?.message);
    console.error('[design] Scene reading failed:', error?.message);
    return null;
  }
  if (kit.contact?.social) scene.copy.social = kit.contact.social;
  if (kit.contact?.web) scene.copy.web = kit.contact.web.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // 3) Side by side: the backdrop (only for art), each photo's place, the breakout cut-outs.
  const photoLayers = scene.layers.filter((l): l is PhotoLayer => l.type === 'photo');
  const slots = refs.map((p) => ({ ...p.slot }));
  const backdropJob: Promise<Buffer | null> =
    scene.backdrop.kind === 'art'
      ? renderImage({ prompt: BACKDROP_PROMPT, images: [{ buffer: concept, name: 'concept.png', contentType: 'image/png' }], size, purpose: 'edit', fidelity: 'high', userId: input.userId, promptName: 'Design · backdrop', use: 'design' })
          .then((b) => sharp(b).resize(cw, ch, { fit: 'fill' }).png().toBuffer())
          .catch((error: any) => {
            console.error('[design] Backdrop failed:', error?.message);
            return null;
          })
      : Promise.resolve(null);
  const placeJobs = photoLayers.map(async (layer) => {
    const ref = refs[layer.photo];
    const r = await refinePlace({ concept, canvasAspect: aspect, layer, photo: ref.buffer, photoWidth: ref.slot.width, photoHeight: ref.slot.height, focal: ref.slot.focal });
    layer.place = r.place;
  });
  const cutJobs = photoLayers
    .filter((l) => l.breakout)
    .map(async (layer) => {
      const c = await cutout(refs[layer.photo].buffer, storeCutout, { subject: layer.subject, userId: input.userId });
      if (c) slots[layer.photo].cutout = { url: c.url, width: c.width, height: c.height, edges: c.edges, box: c.box };
      else layer.breakout = null;
    });
  // Where the photo's main people are (SAM 3 with the reader's words for them, cached), to keep them uncut.
  const peopleJobs = photoLayers.map(async (layer) => {
    if (layer.shape === 'organic') return;
    const c = await cutout(refs[layer.photo].buffer, storeCutout, { subject: layer.subject || 'person', userId: input.userId }).catch(() => null);
    return c ? { layer, box: c.box } : undefined;
  });
  const [backdrop, ...rest] = await Promise.all([backdropJob, ...placeJobs, ...cutJobs, ...peopleJobs]);
  for (const found of rest.slice(placeJobs.length + cutJobs.length) as ({ layer: PhotoLayer; box: { x: number; y: number; w: number; h: number } } | undefined)[]) {
    if (!found) continue;
    const ref = refs[found.layer.photo];
    keepPeopleInFrame(found.layer, found.box, aspect, { width: ref.slot.width, height: ref.slot.height });
  }
  keepGutters(scene);

  // No art after all: the reader's ground colour stands in (the scene stays usable).
  if (scene.backdrop.kind === 'art' && !backdrop) scene.backdrop = { kind: 'color', color: 'primary' };

  // 4) Organic frames: traced from where the concept differs from its backdrop.
  for (const layer of photoLayers.filter((l) => l.shape === 'organic')) {
    const ground = backdrop || (scene.backdrop.kind === 'color' ? kit.colors[scene.backdrop.color].hex : null);
    layer.mask = ground ? (await organicMask({ concept, backdrop: ground, frame: layer.frame }).catch(() => null)) || undefined : undefined;
    if (!layer.mask) {
      // Qwen-Image-Layered on fal (about 5 cents) splits the concept into layers; else a soft blob.
      layer.mask = (await layeredMask(concept, layer, input.userId).catch(() => null)) || undefined;
      if (!layer.mask) layer.shape = 'blob';
    }
  }

  let art: { url: string; width: number; height: number } | null = null;
  if (backdrop) {
    const jpeg = await sharp(backdrop).jpeg({ quality: 90 }).toBuffer();
    art = { url: await uploadBufferToS3(jpeg, 'image/jpeg', 'design-backgrounds'), width: cw, height: ch };
  }
  const id = `scene-${Date.now().toString(36)}${index}`;
  const primary = kit.logos.find((l) => l.role === 'primary');
  const doc = sceneDoc({ id, format, scene, art, photos: slots, sponsors: input.sponsors, primaryLogo: primary?.id || '', campaignLogos: input.campaignLogoIds, conceptUrl });
  return { doc, design: sceneTemplate(scene, id, format, doc.photos), why: brief.name || scene.improvements || 'Read from a concept', conceptUrl };
}

/**
 * An organic frame's mask from Qwen-Image-Layered: the layer that best fills the frame is taken as
 * the photo's shape. Null without a fal key or a clear layer.
 */
async function layeredMask(concept: Buffer, layer: PhotoLayer, userId: Id): Promise<string | null> {
  const { falAvailable, qwenLayers } = await import('./falService');
  if (!(await falAvailable())) return null;
  const layers = await qwenLayers({ image: concept, layers: 5, userId, promptName: 'Design · layers' });
  const meta = await sharp(concept).metadata();
  const W = meta.width || 1024;
  const H = meta.height || 1536;
  const f = layer.frame;
  const left = Math.max(0, Math.floor((f.x / 100) * W));
  const top = Math.max(0, Math.floor((f.y / 100) * H));
  const width = Math.max(8, Math.min(W - left, Math.ceil((f.w / 100) * W)));
  const height = Math.max(8, Math.min(H - top, Math.ceil((f.h / 100) * H)));
  let best: { score: number; alpha: Buffer; w: number; h: number } | null = null;
  for (const png of layers) {
    const alpha = await sharp(png).resize(W, H, { fit: 'fill' }).ensureAlpha().extractChannel(3).png().toBuffer();
    const a = await sharp(alpha).extract({ left, top, width, height }).resize(192, Math.max(8, Math.round((192 * height) / width)), { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    let inside = 0;
    for (const v of a.data) if (v > 128) inside++;
    const share = inside / a.data.length;
    // The photo's layer fills much of its frame but not a plain full rectangle.
    const score = share > 0.2 && share < 0.97 ? share : 0;
    if (score && (!best || score > best.score)) best = { score, alpha: a.data, w: a.info.width, h: a.info.height };
  }
  if (!best) return null;
  const rgba = Buffer.alloc(best.w * best.h * 4, 255);
  for (let i = 0; i < best.w * best.h; i++) rgba[i * 4 + 3] = best.alpha[i];
  const out = await sharp(rgba, { raw: { width: best.w, height: best.h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return `data:image/png;base64,${out.toString('base64')}`;
}

/**
 * The art direction for each option, written for this poster by a quick model from a random draw
 * of the studio's design vocabulary (so no two runs start alike), about a tenth of a US cent for
 * the whole run. Without a key, or if it fails, the draw itself is the direction.
 */
async function artDirections(input: Omit<SceneInput, 'directions'>, n: number): Promise<{ name: string; direction: string }[]> {
  const photos = input.photos.slice(0, 3);
  const seeds: DesignSeed[] = Array.from({ length: n }, () => designSeed(Math.random, photos.length > 0));
  const fallback = seeds.map((seed, i) => ({ name: `Direction ${i + 1}`, direction: directionFromSeed(seed, photos.length > 0) }));
  if (!input.apiKey) return fallback;
  const started = Date.now();
  try {
    const images: ClaudeImage[] = [];
    for (const [i, p] of photos.entries()) images.push({ ...(await small(p.buffer, 448)), label: `Photograph ${i + 1}:` });
    const res = await callClaudeTool<{ directions: { name: string; direction: string }[] }>({
      apiKey: input.apiKey,
      model: DESIGN_MODELS.quick,
      system: ART_DIRECTOR_SYSTEM,
      context: brandText(input.kit),
      prompt: artDirectorPrompt({
        brief: input.brief,
        brand: '',
        sector: input.voice?.sector,
        tone: input.voice?.tone,
        format: input.format,
        photos: photos.map((p) => ({ width: p.slot.width, height: p.slot.height, note: p.description })),
        count: n,
        seeds
      }),
      images,
      tool: ART_DIRECTOR_TOOL,
      maxTokens: 1800
    });
    await input.log('Design · art direction', `anthropic/${res.model}`, res.usage, res.cost, Date.now() - started);
    const out = (res.input.directions || []).filter((d) => d && typeof d.direction === 'string' && d.direction.trim().length > 40).map((d, i) => ({ name: String(d.name || `Direction ${i + 1}`).slice(0, 80), direction: d.direction.trim().slice(0, 1200) }));
    return out.length ? Array.from({ length: n }, (_, i) => out[i % out.length]) : fallback;
  } catch (error: any) {
    await input.log('Design · art direction', `anthropic/${DESIGN_MODELS.quick}`, { input: 0, output: 0 }, 0, Date.now() - started, false, error?.message);
    console.error('[design] Art direction failed, using the random draw:', error?.message);
    return fallback;
  }
}

/** The options for a poster, made side by side; those that fail are left out. */
export async function sceneOptions(input: Omit<SceneInput, 'directions'> & { directions?: SceneInput['directions'] }): Promise<SceneOption[]> {
  const n = Math.max(1, Math.min(4, input.count));
  const job: SceneInput = { ...input, directions: input.directions?.length ? input.directions : await artDirections(input, n) };
  const made = await Promise.all(Array.from({ length: n }, (_, i) => oneScene(job, i).catch((e) => (console.error('[design] Option failed:', e?.message), null))));
  return made.filter((o): o is SceneOption => !!o);
}
