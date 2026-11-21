import mongoose from 'mongoose';
import sharp from 'sharp';
import { LLMUsage } from '../models/LLMUsage';
import { getProviderKey } from './llmService';

/**
 * fal.ai: one key (Settings › AI, or FAL_KEY in .env) for the models the design engine uses beside
 * OpenAI and Anthropic:
 *  - Qwen-Image (make a picture) and Qwen-Image-Edit-Plus (change a picture, several pictures in):
 *    the alternative image models (lib/imageModels.ts), chosen in Settings › AI;
 *  - SAM 3: finds a subject from a few words ("the woman holding the baby") and gives its exact
 *    mask, for cut-outs that break out of a photo's frame;
 *  - BiRefNet: background removal when no subject is named;
 *  - Qwen-Image-Layered: splits a finished picture into transparent layers (organic photo shapes).
 *
 * Calls go through fal's queue (submit, wait, fetch), so a slow model never hits a request timeout.
 * Pictures go in as data URIs, so nothing has to be public first. Every call is logged with its cost.
 */

type Id = mongoose.Types.ObjectId;

export const FAL_MODELS = {
  qwenImage: 'fal-ai/qwen-image',
  qwenEdit: 'fal-ai/qwen-image-edit-plus',
  qwenLayered: 'fal-ai/qwen-image-layered',
  sam3: 'fal-ai/sam-3/image',
  birefnet: 'fal-ai/birefnet/v2'
} as const;

/** US$ per call (fal's posted prices; Qwen-Image is per megapixel, about 0.02 for 1 MP). */
export const FAL_PRICES: Record<string, (megapixels: number) => number> = {
  [FAL_MODELS.qwenImage]: (mp) => 0.02 * Math.max(1, mp),
  [FAL_MODELS.qwenEdit]: () => 0.03,
  [FAL_MODELS.qwenLayered]: () => 0.05,
  [FAL_MODELS.sam3]: () => 0.005,
  [FAL_MODELS.birefnet]: () => 0.003
};

export class FalError extends Error {}

async function falKey(): Promise<string> {
  try {
    return await getProviderKey('fal');
  } catch (error: any) {
    throw new FalError(error?.message || 'fal.ai key not configured');
  }
}

/** Whether a fal key is set (without throwing). */
export async function falAvailable(): Promise<boolean> {
  try {
    await getProviderKey('fal');
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs a fal model through the queue and returns its JSON answer. */
export async function falRun<T = any>(model: string, input: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<T> {
  const key = await falKey();
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(input) });
  if (!submit.ok) throw new FalError(`fal ${model}: ${submit.status} ${(await submit.text()).slice(0, 300)}`);
  const queued: any = await submit.json();
  const statusUrl: string = queued.status_url || `https://queue.fal.run/${model}/requests/${queued.request_id}/status`;
  const responseUrl: string = queued.response_url || `https://queue.fal.run/${model}/requests/${queued.request_id}`;
  const deadline = Date.now() + (options.timeoutMs || 180000);
  let wait = 700;
  for (;;) {
    if (Date.now() > deadline) throw new FalError(`fal ${model}: no answer in time`);
    await sleep(wait);
    wait = Math.min(2500, wait * 1.4);
    const st = await fetch(statusUrl, { headers });
    if (!st.ok) continue;
    const s: any = await st.json();
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED' || s.status === 'ERROR') throw new FalError(`fal ${model}: ${s.error || 'failed'}`);
  }
  const res = await fetch(responseUrl, { headers });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body) throw new FalError(`fal ${model}: ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
  if (body.detail && !body.images && !body.image && !body.masks) throw new FalError(`fal ${model}: ${JSON.stringify(body.detail).slice(0, 300)}`);
  return body as T;
}

/** A picture as a data URI (fal reads these directly). Large pictures are reduced first. */
export async function dataUri(buffer: Buffer, maxSide = 2048): Promise<string> {
  const meta = await sharp(buffer).metadata();
  let out = buffer;
  let type = meta.format === 'png' ? 'image/png' : 'image/jpeg';
  if ((meta.width || 0) > maxSide || (meta.height || 0) > maxSide || (meta.format !== 'png' && meta.format !== 'jpeg')) {
    const s = sharp(buffer).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    out = meta.hasAlpha ? await s.png().toBuffer() : await s.jpeg({ quality: 92 }).toBuffer();
    type = meta.hasAlpha ? 'image/png' : 'image/jpeg';
  }
  return `data:${type};base64,${out.toString('base64')}`;
}

/** The bytes of a picture fal returned (a URL or a data URI). */
export async function fetchFalImage(file: { url?: string } | string | undefined | null): Promise<Buffer> {
  const url = typeof file === 'string' ? file : file?.url;
  if (!url) throw new FalError('fal returned no picture');
  if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const res = await fetch(url);
  if (!res.ok) throw new FalError(`Couldn’t fetch the picture fal made (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function logFal(userId: Id | undefined, promptName: string, model: string, cost: number, ms: number, ok: boolean, error?: string): Promise<void> {
  if (!userId) return;
  try {
    await LLMUsage.create({ userId, promptName, llmModel: `fal/${model}`, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: cost, success: ok, errorMessage: error, requestDuration: ms });
  } catch (e) {
    console.error('[fal] Couldn’t log usage:', e);
  }
}

/** Runs a model and logs it (cost from FAL_PRICES). */
async function logged<T>(userId: Id | undefined, promptName: string, model: string, input: Record<string, unknown>, megapixels = 1): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await falRun<T>(model, input);
    await logFal(userId, promptName, model, (FAL_PRICES[model] || (() => 0))(megapixels), Date.now() - t0, true);
    return out;
  } catch (error: any) {
    await logFal(userId, promptName, model, 0, Date.now() - t0, false, error?.message);
    throw error;
  }
}

const sizeOf = (size: string) => {
  const [w, h] = size.split('x').map(Number);
  return { width: w || 1024, height: h || 1024 };
};

/** Qwen-Image: a picture from words. */
export async function qwenImage(o: { prompt: string; size: string; userId?: Id; promptName: string }): Promise<Buffer> {
  const image_size = sizeOf(o.size);
  const out: any = await logged(o.userId, o.promptName, FAL_MODELS.qwenImage, { prompt: o.prompt, image_size, num_images: 1, output_format: 'png', enable_safety_checker: true }, (image_size.width * image_size.height) / 1e6);
  return fetchFalImage(out.images?.[0] || out.image);
}

/** Qwen-Image-Edit-Plus: changes a picture, or makes one from several (up to 3 in). */
export async function qwenEdit(o: { prompt: string; images: Buffer[]; size?: string; userId?: Id; promptName: string }): Promise<Buffer> {
  const image_urls = await Promise.all(o.images.slice(0, 3).map((b) => dataUri(b)));
  const input: Record<string, unknown> = { prompt: o.prompt, image_urls, num_images: 1, output_format: 'png', enable_safety_checker: true };
  if (o.size) input.image_size = sizeOf(o.size);
  const out: any = await logged(o.userId, o.promptName, FAL_MODELS.qwenEdit, input);
  return fetchFalImage(out.images?.[0] || out.image);
}

/** Qwen-Image-Layered: a picture split into transparent layers (back to front). */
export async function qwenLayers(o: { image: Buffer; layers?: number; caption?: string; userId?: Id; promptName: string }): Promise<Buffer[]> {
  const input: Record<string, unknown> = { image_url: await dataUri(o.image), num_layers: Math.max(2, Math.min(10, o.layers || 4)), output_format: 'png' };
  if (o.caption) input.prompt = o.caption;
  const out: any = await logged(o.userId, o.promptName, FAL_MODELS.qwenLayered, input);
  return Promise.all((out.images || []).map((f: any) => fetchFalImage(f)));
}

/**
 * SAM 3: the mask of what the words describe ("person", "the woman holding the baby"), as one
 * 0..255 value per pixel of the picture (all instances found, joined). Null when nothing matched.
 */
export async function sam3Mask(o: { image: Buffer; prompt: string; userId?: Id; promptName: string }): Promise<{ mask: Buffer; width: number; height: number } | null> {
  const meta = await sharp(o.image).rotate().metadata();
  const width = meta.autoOrient?.width || meta.width || 0;
  const height = meta.autoOrient?.height || meta.height || 0;
  const oriented = await sharp(o.image).rotate().jpeg({ quality: 92 }).toBuffer();
  const out: any = await logged(o.userId, o.promptName, FAL_MODELS.sam3, {
    image_url: await dataUri(oriented),
    prompt: o.prompt,
    apply_mask: false,
    return_multiple_masks: true,
    max_masks: 8,
    output_format: 'png'
  });
  const files = (out.masks || []).filter(Boolean);
  if (!files.length) return null;
  // Join every instance's mask (a group photo has several people), at the photo's size.
  const joined = Buffer.alloc(width * height);
  for (const f of files) {
    const png = await fetchFalImage(f);
    const raw = await sharp(png).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer();
    for (let i = 0; i < joined.length; i++) if (raw[i] > joined[i]) joined[i] = raw[i];
  }
  let any = 0;
  for (let i = 0; i < joined.length; i += 13) if (joined[i] > 128) any++;
  return any ? { mask: joined, width, height } : null;
}

/** BiRefNet: the picture with its background removed (PNG with transparency). */
export async function removeBackground(o: { image: Buffer; userId?: Id; promptName: string }): Promise<Buffer> {
  const out: any = await logged(o.userId, o.promptName, FAL_MODELS.birefnet, {
    image_url: await dataUri(await sharp(o.image).rotate().jpeg({ quality: 92 }).toBuffer()),
    model: 'General Use (Heavy)',
    operating_resolution: '1024x1024',
    output_format: 'png',
    refine_foreground: true
  });
  return fetchFalImage(out.image || out.images?.[0]);
}

/** Settings › AI › Test: a cheap call that proves the key works (SAM 3 on a tiny picture). */
export async function falTest(): Promise<{ ok: boolean; message: string }> {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="18" fill="#c00"/></svg>') }])
    .png()
    .toBuffer();
  await falRun(FAL_MODELS.sam3, { image_url: await dataUri(png), prompt: 'red circle', apply_mask: false }, { timeoutMs: 60000 });
  return { ok: true, message: 'fal.ai key works (SAM 3 answered).' };
}
