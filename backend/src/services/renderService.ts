import sharp from 'sharp';
import { Asset } from '../models/Asset';

const BUCKET_NAME = process.env.AWS_S3_BUCKET || 'campaign-management-assets';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

function publicUrlForKey(key: string): string {
  return `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

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

type Layer = ImageLayer | TextLayer;

export interface StructuredPoster {
  width: number;
  height: number;
  layers: Layer[];
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
 * Render structured poster data (background size + layers) into a flat PNG.
 * Image layers are fetched by assetId and resized into place; text layers
 * are drawn via an SVG overlay, since sharp has no native text API.
 */
export async function renderPoster(structuredData: StructuredPoster): Promise<Buffer> {
  const { width, height, layers = [] } = structuredData;

  if (!width || !height) {
    throw new Error('structuredData.width and structuredData.height are required');
  }

  const composites: sharp.OverlayOptions[] = [];

  for (const layer of layers) {
    if (layer.type === 'image') {
      const { assetId, x, y, width: layerWidth, height: layerHeight } = layer;

      const asset = await Asset.findById(assetId);
      if (!asset) {
        console.warn(`renderPoster: asset ${assetId} not found, skipping layer`);
        continue;
      }

      const response = await fetch(publicUrlForKey(asset.storageKey));
      if (!response.ok) {
        console.warn(`renderPoster: could not fetch asset ${assetId} (${response.status}), skipping layer`);
        continue;
      }

      const sourceBuffer = Buffer.from(await response.arrayBuffer());
      const resized = await sharp(sourceBuffer)
        .resize(Math.round(layerWidth), Math.round(layerHeight), { fit: 'cover' })
        .toBuffer();

      composites.push({
        input: resized,
        left: Math.round(x),
        top: Math.round(y)
      });
    } else if (layer.type === 'text') {
      const { text, font, fontSize = 32, color = '#000000', x, y } = layer;

      const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${escapeXml(font || 'sans-serif')}" font-size="${fontSize}" fill="${escapeXml(color)}">${escapeXml(text)}</text>
      </svg>`;

      composites.push({
        input: Buffer.from(svg),
        left: 0,
        top: 0
      });
    }
  }

  let canvas = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  });

  if (composites.length > 0) {
    canvas = canvas.composite(composites);
  }

  return canvas.png().toBuffer();
}
