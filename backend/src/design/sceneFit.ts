import sharp from 'sharp';
import { placePhoto } from './photoFit';
import { placeFromCrop, type Box, type PhotoLayer } from './scene';

/**
 * Fitting the real photos into a scene, without AI calls:
 *  - refinePlace: the reader says which part of the photo shows in a frame; the engine then finds
 *    exactly where the concept drew it (matching the real photo against the concept inside the
 *    frame) and uses that when the match is clear.
 *  - organicMask: an irregular frame's shape, traced from where the concept differs from its
 *    backdrop (the backdrop is the concept with the photos removed, or a plain colour).
 */

/** The frame on the concept, kept inside it and shrunk away from soft edges, as a mask. */
function frameMask(frame: Box, fade: PhotoLayer['fade'], w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  let x0 = Math.max(0, frame.x);
  let y0 = Math.max(0, frame.y);
  let x1 = Math.min(100, frame.x + frame.w);
  let y1 = Math.min(100, frame.y + frame.h);
  // Away from the frame's edges (8%), and from a fade (its whole size): those pixels are blended.
  const ix = (x1 - x0) * 0.08;
  const iy = (y1 - y0) * 0.08;
  x0 += ix;
  x1 -= ix;
  y0 += iy;
  y1 -= iy;
  if (fade) {
    const s = fade.size / 100;
    if (fade.side === 'left') x0 += (x1 - x0) * s;
    if (fade.side === 'right') x1 -= (x1 - x0) * s;
    if (fade.side === 'top') y0 += (y1 - y0) * s;
    if (fade.side === 'bottom') y1 -= (y1 - y0) * s;
  }
  for (let y = Math.floor((y0 / 100) * h); y < Math.ceil((y1 / 100) * h); y++) {
    for (let x = Math.floor((x0 / 100) * w); x < Math.ceil((x1 / 100) * w); x++) {
      if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 255;
    }
  }
  return m;
}

/**
 * Where the whole real photo sits for this frame (percent of the concept). The match is used when
 * it is clear (and agrees roughly with the reader's crop); otherwise the reader's crop is used.
 */
export async function refinePlace(o: {
  concept: Buffer;
  canvasAspect: number;
  layer: PhotoLayer;
  photo: Buffer;
  photoWidth: number;
  photoHeight: number;
  focal?: { x: number; y: number };
}): Promise<{ place: Box; matched: boolean; score: number }> {
  const fromReader = placeFromCrop(o.layer.frame, o.canvasAspect, { width: o.photoWidth, height: o.photoHeight, focal: o.focal }, o.layer.crop);
  try {
    const meta = await sharp(o.concept).metadata();
    const W = meta.width || 1024;
    const H = meta.height || 1536;
    const mask = frameMask(o.layer.frame, o.layer.fade, W, H);
    const found = await placePhoto({ concept: o.concept, mask, maskWidth: W, maskHeight: H, photo: o.photo, photoWidth: o.photoWidth, photoHeight: o.photoHeight, focal: o.focal });
    if (!found || !found.matched || found.score < 0.4) return { place: fromReader, matched: false, score: found?.score || 0 };
    const place = { x: found.x, y: found.y, w: found.w, h: found.h };
    // A match that must still cover the frame (it was searched on the visible part only).
    const f = o.layer.frame;
    const covers = place.x <= Math.max(0, f.x) + 0.5 && place.y <= Math.max(0, f.y) + 0.5 && place.x + place.w >= Math.min(100, f.x + f.w) - 0.5 && place.y + place.h >= Math.min(100, f.y + f.h) - 0.5;
    if (!covers) return { place: fromReader, matched: false, score: found.score };
    return { place, matched: true, score: found.score };
  } catch {
    return { place: fromReader, matched: false, score: 0 };
  }
}

/**
 * An irregular frame's mask: within the frame, where the concept differs from its backdrop. Returns
 * a small PNG data URI (white = photo), or null when no clear shape comes out (then the frame keeps
 * a soft "blob" shape).
 */
export async function organicMask(o: { concept: Buffer; backdrop: Buffer | string; frame: Box }): Promise<string | null> {
  const meta = await sharp(o.concept).metadata();
  const W = meta.width || 1024;
  const H = meta.height || 1536;
  const fx = Math.max(0, Math.floor((o.frame.x / 100) * W));
  const fy = Math.max(0, Math.floor((o.frame.y / 100) * H));
  const fw = Math.min(W - fx, Math.ceil((o.frame.w / 100) * W));
  const fh = Math.min(H - fy, Math.ceil((o.frame.h / 100) * H));
  if (fw < 16 || fh < 16) return null;
  const S = 192;
  const sw = fw >= fh ? S : Math.max(16, Math.round((S * fw) / fh));
  const sh = fw >= fh ? Math.max(16, Math.round((S * fh) / fw)) : S;
  // One resize per sharp pipeline (a second one replaces the first): to the concept's size, then the frame.
  const crop = async (b: Buffer) => {
    const full = await sharp(b).resize(W, H, { fit: 'fill' }).removeAlpha().png().toBuffer();
    return sharp(full).extract({ left: fx, top: fy, width: fw, height: fh }).resize(sw, sh, { fit: 'fill' }).blur(1.2).raw().toBuffer();
  };
  const a = await crop(o.concept);
  const b =
    typeof o.backdrop === 'string'
      ? await sharp({ create: { width: sw, height: sh, channels: 3, background: o.backdrop } }).raw().toBuffer()
      : await crop(o.backdrop);
  const n = sw * sh;
  const m = Buffer.alloc(n);
  let on = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2]);
    // 0 below 30, full above 90: soft edges stay soft.
    const v = Math.max(0, Math.min(255, Math.round(((d - 30) / 60) * 255)));
    m[i] = v;
    if (v > 128) on++;
  }
  const share = on / n;
  if (share < 0.15 || share > 0.98) return null;
  // Close small holes (a face's flat skin can match a flat backdrop): a blur, then a firmer ramp.
  const smooth = await sharp(m, { raw: { width: sw, height: sh, channels: 1 } }).blur(2.5).raw().toBuffer();
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round((smooth[i] - 70) * 2.2)));
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = v;
  }
  const png = await sharp(rgba, { raw: { width: sw, height: sh, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
