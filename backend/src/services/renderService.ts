import sharp from 'sharp';
import mongoose from 'mongoose';
import { HubAsset } from '../models/HubAsset';
import { getObjectBuffer } from '../utils/s3Service';

/** Thrown for bad client input; routes turn it into a 400. */
export class PosterValidationError extends Error {}

export const MAX_CANVAS = 4096; // px per side — bounds memory use of a single render
const MAX_LAYERS = 50;

interface ImageLayer {
  type: 'image';
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextLayer {
  type: 'text';
  text: string;
  font?: string;
  fontSize?: number;
  color?: string;
  x: number;
  y: number;
}

export type Layer = ImageLayer | TextLayer;

export interface StructuredPoster {
  width: number;
  height: number;
  background?: string;
  layers: Layer[];
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;
const FONT_RE = /^[\w\s,'-]{1,80}$/;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate (and normalise) client-supplied poster data. Throws PosterValidationError.
 */
export function validatePoster(input: any): StructuredPoster {
  if (!input || typeof input !== 'object') {
    throw new PosterValidationError('structuredData is required');
  }
  const { width, height, background, layers = [] } = input;

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new PosterValidationError('structuredData.width and structuredData.height must be positive integers');
  }
  if (width > MAX_CANVAS || height > MAX_CANVAS) {
    throw new PosterValidationError(`Canvas cannot exceed ${MAX_CANVAS}px on a side`);
  }
  if (background !== undefined && !(typeof background === 'string' && COLOR_RE.test(background))) {
    throw new PosterValidationError('structuredData.background must be a colour such as #ffffff');
  }
  if (!Array.isArray(layers) || layers.length > MAX_LAYERS) {
    throw new PosterValidationError(`layers must be an array of at most ${MAX_LAYERS} items`);
  }

  const clean: Layer[] = layers.map((layer: any, i: number): Layer => {
    const at = `layers[${i}]`;
    if (!layer || typeof layer !== 'object') throw new PosterValidationError(`${at} is invalid`);
    if (!isNum(layer.x) || !isNum(layer.y)) throw new PosterValidationError(`${at}.x and .y must be numbers`);

    if (layer.type === 'image') {
      if (typeof layer.assetId !== 'string' || !mongoose.isValidObjectId(layer.assetId)) {
        throw new PosterValidationError(`${at}.assetId must be a valid asset id`);
      }
      if (!isNum(layer.width) || !isNum(layer.height) || layer.width < 1 || layer.height < 1 ||
          layer.width > MAX_CANVAS || layer.height > MAX_CANVAS) {
        throw new PosterValidationError(`${at}.width and .height must be between 1 and ${MAX_CANVAS}`);
      }
      return { type: 'image', assetId: layer.assetId, x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    }

    if (layer.type === 'text') {
      if (typeof layer.text !== 'string' || layer.text.length === 0 || layer.text.length > 500) {
        throw new PosterValidationError(`${at}.text must be 1–500 characters`);
      }
      if (layer.fontSize !== undefined && (!isNum(layer.fontSize) || layer.fontSize < 6 || layer.fontSize > 400)) {
        throw new PosterValidationError(`${at}.fontSize must be between 6 and 400`);
      }
      if (layer.color !== undefined && !(typeof layer.color === 'string' && COLOR_RE.test(layer.color))) {
        throw new PosterValidationError(`${at}.color must be a colour such as #000000`);
      }
      if (layer.font !== undefined && !(typeof layer.font === 'string' && FONT_RE.test(layer.font))) {
        throw new PosterValidationError(`${at}.font contains invalid characters`);
      }
      return { type: 'text', text: layer.text, font: layer.font, fontSize: layer.fontSize, color: layer.color, x: layer.x, y: layer.y };
    }

    throw new PosterValidationError(`${at}.type must be "image" or "text"`);
  });

  return { width, height, background, layers: clean };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Render validated poster data to a flat PNG.
 * Image layers are loaded from private storage and must belong to `userId`
 * (so one user can never composite another user's files); text layers are drawn as SVG.
 */
export async function renderPoster(poster: StructuredPoster, userId: mongoose.Types.ObjectId): Promise<Buffer> {
  const { width, height, background = '#ffffff', layers } = poster;
  const composites: sharp.OverlayOptions[] = [];

  for (const layer of layers) {
    if (layer.type === 'image') {
      const asset = await HubAsset.findOne({ _id: layer.assetId, userId });
      if (!asset) {
        throw new PosterValidationError(`Image layer refers to an asset you don't have: ${layer.assetId}`);
      }

      const source = await getObjectBuffer(asset.storageKey);
      const w = Math.round(layer.width);
      const h = Math.round(layer.height);
      const x = Math.round(layer.x);
      const y = Math.round(layer.y);

      // Crop away any part of the layer hanging off the canvas (sharp rejects overflowing overlays).
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const cropLeft = left - x;
      const cropTop = top - y;
      const visibleW = Math.min(w - cropLeft, width - left);
      const visibleH = Math.min(h - cropTop, height - top);
      if (visibleW < 1 || visibleH < 1) continue; // entirely off-canvas

      const input = await sharp(source)
        .resize(w, h, { fit: 'cover' })
        .extract({ left: cropLeft, top: cropTop, width: visibleW, height: visibleH })
        .toBuffer();

      composites.push({ input, left, top });
    } else {
      const { text, font, fontSize = 32, color = '#000000', x, y } = layer;
      const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${escapeXml(font || 'sans-serif')}" font-size="${fontSize}" fill="${escapeXml(color)}">${escapeXml(text)}</text>
      </svg>`;
      composites.push({ input: Buffer.from(svg), left: 0, top: 0 });
    }
  }

  let canvas = sharp({ create: { width, height, channels: 4, background } });
  if (composites.length > 0) canvas = canvas.composite(composites);
  return canvas.png().toBuffer();
}
