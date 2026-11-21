import crypto from 'crypto';
import sharp from 'sharp';
import { exifCaptureDate } from './exif';

/**
 * Image processing for the Library (sharp): size, capture date, gallery thumbnail, a smaller JPEG for
 * AI analysis, and a 64-bit difference hash used to spot near-identical images (versions/duplicates).
 */
export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  exifDate: Date | null;
  thumbnail: Buffer; // webp, max 512px
  aiImage: Buffer; // jpeg, max 1024px, for vision models
  dhash: string; // 16 hex chars
}

export async function differenceHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += data[y * 9 + x] < data[y * 9 + x + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Number of differing bits between two 64-bit hex hashes (0 = identical look, ≤10 = very similar). */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export async function inspectImage(input: Buffer): Promise<ImageInfo | null> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { failOn: 'none' }).metadata();
  } catch {
    return null;
  }
  if (!meta.width || !meta.height) return null;
  const rotated = (meta.orientation || 1) >= 5;
  const [thumbnail, aiImage, dhash] = await Promise.all([
    sharp(input, { failOn: 'none' }).rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
    sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80 })
      .toBuffer(),
    differenceHash(input)
  ]);
  return {
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
    format: meta.format || 'unknown',
    exifDate: exifCaptureDate(meta.exif),
    thumbnail,
    aiImage,
    dhash
  };
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
