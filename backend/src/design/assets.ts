import sharp from 'sharp';
import type { FocalPoint, LogoAsset, LogoVariant } from './types';

/**
 * Getting real-world files ready for posters.
 *
 * Logos: clubs upload what they have, often a JPG with a white box around it. The box is removed by
 * filling inwards from the edges only (white parts inside the logo stay), soft edges are cleaned so
 * no white halo shows on dark colours, and the file is trimmed to what's visible. The logo's colours
 * are never changed.
 *
 * Photos: the subject's position is found (skin tones, detail and colour), so crops keep people in
 * frame. The Library's AI reading can add the subject's box on top (FocalPoint.box).
 */

export interface PreparedLogo {
  png: Buffer;
  width: number;
  height: number;
  ink: number;
  lightness: number;
  onLight: boolean;
  onDark: boolean;
  /** True when a solid background box was removed. */
  removedBox: boolean;
  /** True when the file is small for print (under 600 px on its long side). */
  lowRes: boolean;
}

const MAX_LOGO = 1600;

function colorDist(d: Buffer, i: number, c: [number, number, number]): number {
  const dr = d[i] - c[0];
  const dg = d[i + 1] - c[1];
  const db = d[i + 2] - c[2];
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

export async function prepareLogo(input: Buffer): Promise<PreparedLogo> {
  const base = sharp(input, { failOn: 'none' }).rotate().ensureAlpha();
  const meta = await base.metadata();
  const longSide = Math.max(meta.width || 0, meta.height || 0);
  const resized = longSide > MAX_LOGO ? base.resize({ width: MAX_LOGO, height: MAX_LOGO, fit: 'inside' }) : base;
  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const C = info.channels; // 4
  const px = (x: number, y: number) => (y * W + x) * C;

  // Border pixels: is there a solid background box?
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(px(x, 0), px(x, H - 1));
  for (let y = 0; y < H; y++) border.push(px(0, y), px(W - 1, y));
  const opaqueBorder = border.filter((i) => data[i + 3] > 200);
  let removedBox = false;
  if (opaqueBorder.length > border.length * 0.6) {
    const med = (k: number) => {
      const v = opaqueBorder.map((i) => data[i + k]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    const bg: [number, number, number] = [med(0), med(1), med(2)];
    const uniform = opaqueBorder.filter((i) => colorDist(data, i, bg) < 22).length / opaqueBorder.length;
    if (uniform > 0.85) {
      removedBox = true;
      const T = 26;
      const seen = new Uint8Array(W * H);
      const stack: number[] = [];
      const pushIf = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const k = y * W + x;
        if (seen[k]) return;
        if (colorDist(data, k * C, bg) <= T) {
          seen[k] = 1;
          stack.push(k);
        }
      };
      for (let x = 0; x < W; x++) {
        pushIf(x, 0);
        pushIf(x, H - 1);
      }
      for (let y = 0; y < H; y++) {
        pushIf(0, y);
        pushIf(W - 1, y);
      }
      while (stack.length) {
        const k = stack.pop()!;
        const x = k % W;
        const y = (k - x) / W;
        data[k * C + 3] = 0;
        pushIf(x + 1, y);
        pushIf(x - 1, y);
        pushIf(x, y + 1);
        pushIf(x, y - 1);
      }
      // Soft edges next to the removed area: un-mix the background colour so no halo remains.
      const ring = (k: number) => {
        const x = k % W;
        const y = (k - x) / W;
        return (x > 0 && seen[k - 1]) || (x < W - 1 && seen[k + 1]) || (y > 0 && seen[k - W]) || (y < H - 1 && seen[k + W]);
      };
      for (let k = 0; k < W * H; k++) {
        if (seen[k] || !ring(k)) continue;
        const i = k * C;
        const d = colorDist(data, i, bg);
        if (d >= T * 3) continue;
        const a = Math.max(0.15, Math.min(1, d / (T * 3)));
        for (let ch = 0; ch < 3; ch++) data[i + ch] = Math.max(0, Math.min(255, Math.round((data[i + ch] - (1 - a) * bg[ch]) / a)));
        data[i + 3] = Math.round(data[i + 3] * a);
      }
    }
  }

  // Trim to what's visible.
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[px(x, y) + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('This logo file looks empty.');
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  let inkCount = 0;
  let lightSum = 0;
  let weight = 0;
  let darkInk = 0;
  let whiteInk = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = px(x, y);
      const a = data[i + 3] / 255;
      if (a > 0.05) {
        const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        lightSum += l * a;
        weight += a;
        if (a > 0.5) {
          inkCount++;
          if (l < 0.3) darkInk++;
          else if (l > 0.82) whiteInk++;
        }
      }
    }
  }
  const png = await sharp(data, { raw: { width: W, height: H, channels: C as 4 } })
    .extract({ left: x0, top: y0, width: tw, height: th })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    png,
    width: tw,
    height: th,
    ink: Math.round((inkCount / (tw * th)) * 1000) / 1000,
    lightness: weight ? Math.round((lightSum / weight) * 1000) / 1000 : 0.5,
    // Which backgrounds it reads on: dark ink needs light; mostly-white ink needs dark.
    onLight: darkInk / Math.max(1, inkCount) >= 0.06 || whiteInk / Math.max(1, inkCount) < 0.25,
    onDark: darkInk / Math.max(1, inkCount) < 0.06,
    removedBox,
    lowRes: Math.max(meta.width || 0, meta.height || 0) < 600
  };
}

/** The variant a prepared logo naturally is: light ink reads on dark, dark ink on light. */
export function guessVariant(p: Pick<PreparedLogo, 'onLight' | 'onDark'>): LogoVariant {
  if (p.onDark && !p.onLight) return 'reverse';
  return 'color';
}

export function logoAsset(id: string, url: string, p: Pick<PreparedLogo, 'width' | 'height' | 'ink' | 'lightness' | 'onLight' | 'onDark'>, variant?: LogoVariant): LogoAsset {
  return { id, url, variant: variant || guessVariant(p), width: p.width, height: p.height, ink: p.ink, lightness: p.lightness, onLight: p.onLight, onDark: p.onDark };
}

/**
 * Where a photo's subject is. Two attention crops (a tall slice and a wide slice) give the subject's
 * x and y; the result is 0..1 from the left and top.
 */
export async function findFocal(input: Buffer): Promise<FocalPoint & { width: number; height: number }> {
  const img = sharp(input, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  const { width: W0, height: H0 } = orientedSize(meta);
  const small = await sharp(input, { failOn: 'none' }).rotate().resize({ width: 480, height: 480, fit: 'inside' }).toBuffer({ resolveWithObject: true });
  const w = small.info.width;
  const h = small.info.height;
  const crop = async (cw: number, ch: number) => {
    const { info } = await sharp(small.data)
      .resize({ width: Math.max(1, Math.round(cw)), height: Math.max(1, Math.round(ch)), fit: 'cover', position: (sharp as any).strategy.attention })
      .toBuffer({ resolveWithObject: true });
    return info as any;
  };
  // A tall slice (a third of the width) finds x; a wide slice (a third of the height) finds y.
  const tall = await crop(w / 3, h);
  const wide = await crop(w, h / 3);
  const fx = typeof tall.attentionX === 'number' ? tall.attentionX / w : (Math.abs(tall.cropOffsetLeft || 0) + w / 6) / w;
  const fy = typeof wide.attentionY === 'number' ? wide.attentionY / h : (Math.abs(wide.cropOffsetTop || 0) + h / 6) / h;
  return { x: clamp01(fx), y: clamp01(fy), width: W0, height: H0 };
}

/** Width and height as the photo is seen (EXIF orientations 5–8 turn it on its side). */
export function orientedSize(meta: { width?: number; height?: number; orientation?: number }): { width: number; height: number } {
  const w = meta.width || 1;
  const h = meta.height || 1;
  return meta.orientation && meta.orientation >= 5 ? { width: h, height: w } : { width: w, height: h };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5));

/** The photo's average brightness (0..1) and whether it is low resolution for a poster. */
export async function photoStats(input: Buffer): Promise<{ brightness: number; lowRes: boolean; width: number; height: number }> {
  const s = await sharp(input, { failOn: 'none' }).rotate().stats();
  const meta = await sharp(input, { failOn: 'none' }).rotate().metadata();
  const [r, g, b] = s.channels;
  const brightness = (0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean) / 255;
  const { width, height } = orientedSize(meta);
  return { brightness, lowRes: Math.max(width, height) < 1200, width, height };
}
