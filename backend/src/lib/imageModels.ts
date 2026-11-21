/**
 * Which OpenAI image model makes and edits pictures, in one place (no database or network here).
 *
 * gpt-image-1.5 (and the older gpt-image-1 family) is retired by OpenAI on 1 December 2026. The app
 * now defaults to the GPT-Image-2.5 pair, released 8 September 2026, at the same price list as
 * gpt-image-2:
 *  - gpt-image-2.5-flare: the fast, high-quality default for making pictures (Create image,
 *    design backgrounds);
 *  - gpt-image-2.5-sunburst: slower, more precise editing (Change image, blending edits).
 *
 * An admin can pick another model from IMAGE_MODELS (Settings › AI). A stored retired model is never
 * sent to OpenAI: it falls back to the default, so pictures keep working after 1 December.
 */

export type ImagePurpose = 'create' | 'edit';

export interface ImageModelInfo {
  id: string;
  label: string;
  /** US$ per million tokens: text in, picture in, picture out. */
  price: { textIn: number; imageIn: number; out: number };
  /** Only the 1.x models take `input_fidelity`; 2.x reads input pictures at high fidelity on its own. */
  inputFidelity: boolean;
  /** Retired models are never called (they fall back to the default). */
  retired?: boolean;
}

export const IMAGE_MODELS: ImageModelInfo[] = [
  { id: 'gpt-image-2.5-flare', label: 'GPT-Image-2.5 Flare (fast, default)', price: { textIn: 5, imageIn: 8, out: 30 }, inputFidelity: false },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT-Image-2.5 Sunburst (precise editing)', price: { textIn: 5, imageIn: 8, out: 30 }, inputFidelity: false },
  { id: 'gpt-image-2', label: 'GPT Image 2', price: { textIn: 5, imageIn: 8, out: 30 }, inputFidelity: false },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5 (retired 1 Dec 2026)', price: { textIn: 5, imageIn: 8, out: 32 }, inputFidelity: true, retired: true },
  { id: 'gpt-image-1', label: 'GPT Image 1 (retired)', price: { textIn: 5, imageIn: 10, out: 40 }, inputFidelity: true, retired: true },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 mini (retired)', price: { textIn: 2, imageIn: 2.5, out: 8 }, inputFidelity: true, retired: true }
];

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare';
export const DEFAULT_EDIT_MODEL = 'gpt-image-2.5-sunburst';

/** Every image model's usage is logged as "openai/<model>"; this matches all of them. */
export const IMAGE_USAGE_MODEL_PATTERN = /^openai\/gpt-image/;

export const isImageModelId = (v: unknown): v is string => typeof v === 'string' && /^gpt-image/.test(v.trim());

export function imageModelInfo(id: string | null | undefined): ImageModelInfo | undefined {
  return IMAGE_MODELS.find((m) => m.id === (id || '').trim());
}

/** The models an admin can choose (retired ones are listed only so old settings read clearly). */
export const SELECTABLE_IMAGE_MODELS = IMAGE_MODELS.filter((m) => !m.retired).map((m) => m.id);

/**
 * The model to call. `configured` is the admin's choice (AppConfig.defaultImageLLMModel). Edits use
 * Sunburst unless the admin picked a specific non-default model, which then serves both purposes.
 */
export function resolveImageModel(purpose: ImagePurpose, configured?: string | null): string {
  const info = imageModelInfo(configured);
  const usable = info && !info.retired ? info.id : null;
  if (purpose === 'edit') return usable && usable !== DEFAULT_IMAGE_MODEL ? usable : DEFAULT_EDIT_MODEL;
  return usable || DEFAULT_IMAGE_MODEL;
}

/** Extra request settings the model accepts (`input_fidelity` only where it exists). */
export function editExtras(model: string, fidelity?: 'high' | 'low'): Record<string, unknown> {
  return fidelity && imageModelInfo(model)?.inputFidelity ? { input_fidelity: fidelity } : {};
}

/** The cost of one call from the usage OpenAI returns (US$). Unknown models use the default's prices. */
export function imageCost(model: string, usage: { textIn: number; imageIn: number; out: number }): number {
  const p = (imageModelInfo(model) || imageModelInfo(DEFAULT_IMAGE_MODEL)!).price;
  return (usage.textIn * p.textIn + usage.imageIn * p.imageIn + usage.out * p.out) / 1_000_000;
}

/**
 * Quality setting from IMAGE_QUALITY in the server's .env: low, medium (the default), high, xhigh,
 * max (xhigh and max exist on GPT-Image-2.5 only) or auto.
 */
export function qualityFor(model: string, raw: string | undefined): string {
  const q = String(raw || '').trim().toLowerCase();
  const is25 = /^gpt-image-2\.5/.test(model);
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'auto') return q;
  if ((q === 'xhigh' || q === 'max') && is25) return q;
  if (q === 'xhigh' || q === 'max') return 'high';
  return 'medium';
}
