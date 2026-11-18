import sharp from 'sharp';
import { logoBox, type LogoCorner } from './postPicture';

/**
 * Finishes an AI picture: trims it to the exact shape, stamps the real logo file in a corner, and
 * encodes it as JPEG (about 5–8× smaller than the PNG the AI returns; every platform accepts it).
 * Only sharp, no storage, so it's tested in scripts/postsSelfTest.ts.
 */
export const JPEG_QUALITY = 88;

export async function composePicture(
  raw: Buffer,
  target: { width: number; height: number },
  logo: { buffer: Buffer; corner: LogoCorner } | null
): Promise<Buffer> {
  let base = await sharp(raw, { failOn: 'none' })
    .rotate()
    .resize({ width: target.width, height: target.height, fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  if (logo) {
    // density: SVG logos are drawn sharply at any size.
    const meta = await sharp(logo.buffer, { failOn: 'none', density: 300 }).metadata();
    const box = logoBox(target.width, target.height, meta.width || 1, meta.height || 1, logo.corner);
    const stamp = await sharp(logo.buffer, { failOn: 'none', density: 300 })
      .resize({ width: box.width, height: box.height, fit: 'inside' })
      .png()
      .toBuffer();
    base = await sharp(base).composite([{ input: stamp, left: box.left, top: box.top }]).png().toBuffer();
  }
  return sharp(base).flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}
