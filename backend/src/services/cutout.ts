import crypto from 'crypto';
import fs from 'fs';
import sharp from 'sharp';
import mongoose, { Schema } from 'mongoose';
import { cutoutEdges } from '../design/assets';
import type { CutEdges } from '../design/types';

/**
 * Cut-outs: the subject of a photo (usually one person) separated from its background, so designs
 * can stand them beside the headline the way local event posters do (docs/DESIGN_ENGINE.md).
 *
 * This is done by a segmentation model that only decides which pixels belong to the subject. It is
 * never done with an image generator: those redraw the picture and can change a real person's face,
 * which a club cannot accept for its guest of honour.
 *
 * Provider: onnxruntime-node running an open-licence model file on the server.
 *   CUTOUT_MODEL       path to the .onnx file (e.g. BiRefNet-lite, MIT; or u2net_human_seg, Apache-2.0)
 *   CUTOUT_MODEL_KIND  "birefnet" (default; outputs logits) or "u2net" (outputs 0..1)
 *   CUTOUT_MODEL_SIZE  the model's input size (default 1024 for BiRefNet, 320 for U²-Net)
 * Without a model, cutout() answers null: designs that need a cut-out are skipped and the others use
 * their photo look. Results are cached by the photo's bytes.
 */

export interface Cutout {
  /** Transparent PNG trimmed to the subject (with a little room). */
  png: Buffer;
  width: number;
  height: number;
  /** Where the subject was in the original photo (0..1). */
  box: { x: number; y: number; w: number; h: number };
  /** Share of the photo the subject covers. */
  coverage: number;
}

// ---- Model ------------------------------------------------------------------------------------

type Session = { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>; inputNames: readonly string[]; outputNames: readonly string[] };
let session: Promise<{ ort: any; session: Session } | null> | null = null;

export function cutoutAvailable(): boolean {
  const file = process.env.CUTOUT_MODEL;
  return !!file && fs.existsSync(file);
}

async function loadModel(): Promise<{ ort: any; session: Session } | null> {
  if (!cutoutAvailable()) return null;
  if (!session) {
    session = (async () => {
      try {
        // Optional dependency: loaded only when a model is configured.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ort = require('onnxruntime-node');
        const s = await ort.InferenceSession.create(process.env.CUTOUT_MODEL!, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
        return { ort, session: s as Session };
      } catch (error) {
        console.error('Cut-out model could not be loaded:', (error as Error).message);
        return null;
      }
    })();
  }
  return session;
}

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The model's answer: one 0..255 value per pixel of the original photo (255 = subject). */
async function predictMask(input: Buffer, width: number, height: number): Promise<Buffer | null> {
  const model = await loadModel();
  if (!model) return null;
  const kind = (process.env.CUTOUT_MODEL_KIND || 'birefnet').toLowerCase();
  const S = Number(process.env.CUTOUT_MODEL_SIZE) || (kind === 'u2net' ? 320 : 1024);
  const rgb = await sharp(input).rotate().removeAlpha().resize(S, S, { fit: 'fill' }).raw().toBuffer();
  const tensor = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) {
    for (let c = 0; c < 3; c++) tensor[c * S * S + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  }
  const feeds = { [model.session.inputNames[0]]: new model.ort.Tensor('float32', tensor, [1, 3, S, S]) };
  const out = await model.session.run(feeds);
  // BiRefNet's last output is the finest map; U²-Net's first is.
  const name = kind === 'u2net' ? model.session.outputNames[0] : model.session.outputNames[model.session.outputNames.length - 1];
  const raw = out[name].data;
  const small = Buffer.alloc(S * S);
  if (kind === 'u2net') {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < S * S; i++) {
      lo = Math.min(lo, raw[i]);
      hi = Math.max(hi, raw[i]);
    }
    const span = hi - lo || 1;
    for (let i = 0; i < S * S; i++) small[i] = Math.round(((raw[i] - lo) / span) * 255);
  } else {
    for (let i = 0; i < S * S; i++) small[i] = Math.round(255 / (1 + Math.exp(-raw[i])));
  }
  return sharp(small, { raw: { width: S, height: S, channels: 1 } }).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer();
}

// ---- Turning a mask into a cut-out (pure; tested by the self-test) ------------------------------

/**
 * Applies a mask to a photo: soft edges kept (hair), stray specks and faint haze dropped, trimmed
 * to the subject with a little room. Returns null when the mask doesn't look like one clear subject.
 */
export async function applyMask(rgba: Buffer, mask: Buffer, width: number, height: number, options: { all?: boolean } = {}): Promise<Cutout | null> {
  const n = width * height;
  // Tighten the matte: below 8% is background, above 92% is solid; in between stays soft.
  const alpha = Buffer.alloc(n);
  let solid = 0;
  for (let i = 0; i < n; i++) {
    const v = mask[i] / 255;
    const a = v <= 0.08 ? 0 : v >= 0.92 ? 1 : (v - 0.08) / 0.84;
    alpha[i] = Math.round(a * 255);
    if (a >= 0.5) solid++;
  }
  const coverage = solid / n;
  if (coverage < 0.03 || coverage > 0.85) return null;

  // Keep the largest solid region (the subject) and what touches it; drop islands. With "all" (a
  // named subject found by SAM 3, e.g. several people), every sizeable region stays.
  const keep = options.all ? sizeableRegions(alpha, width, height) : largestRegion(alpha, width, height);
  if (!keep) return null;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!keep[i]) alpha[i] = 0;
      if (alpha[i] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return null;

  const out = Buffer.from(rgba);
  for (let i = 0; i < n; i++) out[i * 4 + 3] = Math.min(out[i * 4 + 3], alpha[i]);
  // A little room so soft edges aren't clipped; none at the photo's own edges (a body cut by the
  // frame must stay a straight line to stand on a band or the poster's edge).
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.015);
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  const right = Math.min(width - 1, x1 + pad);
  const bottom = Math.min(height - 1, y1 + pad);
  const w = right - left + 1;
  const h = bottom - top + 1;
  const png = await sharp(out, { raw: { width, height, channels: 4 } }).extract({ left, top, width: w, height: h }).png({ compressionLevel: 9 }).toBuffer();
  return { png, width: w, height: h, box: { x: left / width, y: top / height, w: w / width, h: h / height }, coverage };
}

/** Flood fill over pixels at least half opaque; returns the largest region grown by its soft edge. */
function largestRegion(alpha: Buffer, width: number, height: number): Uint8Array | null {
  const n = width * height;
  const label = new Int32Array(n);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (label[s] || alpha[s] < 128) continue;
    next++;
    let size = 0;
    stack.push(s);
    label[s] = next;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && !label[i - 1] && alpha[i - 1] >= 128) (label[i - 1] = next), stack.push(i - 1);
      if (x < width - 1 && !label[i + 1] && alpha[i + 1] >= 128) (label[i + 1] = next), stack.push(i + 1);
      if (y > 0 && !label[i - width] && alpha[i - width] >= 128) (label[i - width] = next), stack.push(i - width);
      if (y < height - 1 && !label[i + width] && alpha[i + width] >= 128) (label[i + width] = next), stack.push(i + width);
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  if (!best) return null;
  // The region, plus the soft pixels within a few pixels of it (hair, edges).
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (label[i] === best) keep[i] = 1;
  const grow = Math.max(2, Math.round(Math.max(width, height) / 300));
  for (let pass = 0; pass < grow; pass++) {
    const add: number[] = [];
    for (let i = 0; i < n; i++) {
      if (keep[i] || !alpha[i]) continue;
      const x = i % width;
      if ((x > 0 && keep[i - 1]) || (x < width - 1 && keep[i + 1]) || (i >= width && keep[i - width]) || (i + width < n && keep[i + width])) add.push(i);
    }
    if (!add.length) break;
    for (const i of add) keep[i] = 1;
  }
  return keep;
}

/** Every region at least half opaque and bigger than 0.4% of the photo, with its soft edge. */
function sizeableRegions(alpha: Buffer, width: number, height: number): Uint8Array | null {
  const n = width * height;
  const label = new Int32Array(n);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (label[s] || alpha[s] < 128) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && !label[i - 1] && alpha[i - 1] >= 128) (label[i - 1] = id), stack.push(i - 1);
      if (x < width - 1 && !label[i + 1] && alpha[i + 1] >= 128) (label[i + 1] = id), stack.push(i + 1);
      if (y > 0 && !label[i - width] && alpha[i - width] >= 128) (label[i - width] = id), stack.push(i - width);
      if (y < height - 1 && !label[i + width] && alpha[i + width] >= 128) (label[i + width] = id), stack.push(i + width);
    }
    sizes.push(size);
  }
  const keep = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (label[i] && sizes[label[i]] >= n * 0.004) {
      keep[i] = 1;
      any = true;
    }
  }
  if (!any) return null;
  for (let i = 0; i < n; i++) {
    if (keep[i] || !alpha[i]) continue;
    const x = i % width;
    if ((x > 0 && keep[i - 1]) || (x < width - 1 && keep[i + 1]) || (i >= width && keep[i - width]) || (i + width < n && keep[i + width])) keep[i] = 2;
  }
  return keep;
}

// ---- Cache -------------------------------------------------------------------------------------

interface ICutoutCache {
  hash: string;
  url: string | null;
  width: number;
  height: number;
  box: { x: number; y: number; w: number; h: number };
  coverage: number;
  edges?: CutEdges;
  createdAt: Date;
}
export const CutoutCache =
  (mongoose.models.CutoutCache as mongoose.Model<ICutoutCache>) ||
  mongoose.model<ICutoutCache>(
    'CutoutCache',
    new Schema<ICutoutCache>(
      {
        hash: { type: String, required: true, unique: true },
        url: { type: String, default: null },
        width: Number,
        height: Number,
        box: { x: Number, y: Number, w: Number, h: Number },
        coverage: Number,
        edges: { left: Boolean, right: Boolean, top: Boolean, bottom: Boolean }
      },
      { timestamps: { createdAt: true, updatedAt: false } }
    )
  );

/**
 * The subject of a photo, cut out and stored (cached by the photo's bytes and the subject asked for).
 * Who cuts it out, in order: the model on the server (CUTOUT_MODEL), SAM 3 on fal.ai for a named
 * subject ("the woman holding the baby"; default "person", every person kept), or BiRefNet on
 * fal.ai (the main subject). Null when none is set up, or when the photo has no clear subject.
 * Segmentation only decides which pixels belong to the subject: the pixels are always the photo's.
 */
export async function cutout(
  photo: Buffer,
  store: (png: Buffer) => Promise<string>,
  options: { subject?: string; userId?: mongoose.Types.ObjectId } = {}
): Promise<{ url: string; width: number; height: number; box: Cutout['box']; edges?: CutEdges } | null> {
  const { falAvailable } = await import('./falService');
  const local = cutoutAvailable();
  const fal = !local && (await falAvailable());
  if (!local && !fal) return null;
  const subject = (options.subject || '').trim().slice(0, 120);
  const hash = crypto.createHash('sha1').update(photo).update(local ? '' : `|${subject || 'person'}`).digest('hex');
  const cached = await CutoutCache.findOne({ hash }).lean();
  if (cached) return cached.url ? { url: cached.url, width: cached.width, height: cached.height, box: cached.box, edges: cached.edges } : null;
  try {
    // Work at most at 2000 px on the long side: plenty for a poster, quick on a CPU.
    const { data, info } = await sharp(photo, { failOn: 'none' }).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    let mask: Buffer | null = null;
    let all = false;
    if (local) mask = await predictMask(png, info.width, info.height);
    else {
      const { sam3Mask, removeBackground } = await import('./falService');
      const found = await sam3Mask({ image: png, prompt: subject || 'person', userId: options.userId, promptName: 'Design · cut-out' }).catch((e) => {
        console.error('[cutout] SAM 3 failed:', e?.message);
        return null;
      });
      if (found) {
        mask = await sharp(found.mask, { raw: { width: found.width, height: found.height, channels: 1 } }).resize(info.width, info.height, { fit: 'fill' }).extractChannel(0).raw().toBuffer();
        all = true;
      } else {
        const cut = await removeBackground({ image: png, userId: options.userId, promptName: 'Design · cut-out' });
        mask = await sharp(cut).resize(info.width, info.height, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer();
      }
    }
    const result = mask ? await applyMask(data, mask, info.width, info.height, { all }) : null;
    const url = result ? await store(result.png) : null;
    const edges = result ? await cutoutEdges(result.png) : undefined;
    await CutoutCache.create({ hash, url, width: result?.width || 0, height: result?.height || 0, box: result?.box || { x: 0, y: 0, w: 0, h: 0 }, coverage: result?.coverage || 0, edges }).catch(() => undefined);
    return result && url ? { url, width: result.width, height: result.height, box: result.box, edges } : null;
  } catch (error) {
    console.error('Cut-out failed:', (error as Error).message);
    return null;
  }
}
