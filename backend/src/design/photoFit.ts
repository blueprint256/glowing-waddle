import sharp from 'sharp';

/**
 * Real photos, used the way a concept used them (concept posters with the user's photos).
 *
 * The image model designs the concept with the real photos as references: it crops them, fades
 * them into colour, lets panels and words overlap them. One image edit then removes the concept's
 * words and logos and paints every area where photo N shows in a flat key colour. From that:
 *   - keyMasks: the exact shape where each photo shows (fades and overlaps included), and the art
 *     layer with those areas made transparent, so the real photo, placed underneath, shows through;
 *   - placePhoto: where the real photo sits and how big it is, found by matching the real photo
 *     against the concept inside its shape (no AI call); when the match is weak, the photo covers
 *     its shape around its subject.
 * The finished poster always shows the real photo's own pixels: the image model never redraws it.
 */

/** Key colours, one per photo. */
export const PHOTO_KEYS = ['#00ff00', '#ff00ff', '#00ffff'];
const KEY_RGB = PHOTO_KEYS.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

export interface KeyResult {
  width: number;
  height: number;
  /** One per key colour: 1 where that photo shows (0..255 coverage). */
  masks: Uint8Array[];
  /** Share of the poster each photo covers (0..1). */
  areas: number[];
  /** The art layer: a PNG with the photo areas transparent. */
  artPng: Buffer;
}

/**
 * How strongly a pixel shows key k (0..1): the key's own channels above its missing one (green:
 * g − max(r, b); magenta: min(r, b) − g; cyan: min(g, b) − r). A fade from the key into any
 * colour moves this smoothly to 0.
 */
function keyAmount(r: number, g: number, b: number, k: number): number {
  const v = k === 0 ? g - Math.max(r, b) : k === 1 ? Math.min(r, b) - g : Math.min(g, b) - r;
  return Math.max(0, Math.min(1, v / 200));
}

/**
 * Finds the key-coloured areas in the keyed art and makes them transparent. Solid key areas are
 * found first; soft edges and fades are grown out from them (so a purple panel elsewhere is never
 * mistaken for a magenta fade), and each soft pixel is un-mixed: its transparency is how much key
 * it holds, and its colour is the art colour behind it.
 */
export async function keyMasks(keyed: Buffer, count: number): Promise<KeyResult> {
  const { data, info } = await sharp(keyed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const n = width * height;
  const keys = KEY_RGB.slice(0, Math.max(1, Math.min(3, count)));
  const masks = keys.map(() => new Uint8Array(n));
  const owner = new Int8Array(n).fill(-1);
  const amount = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bv = 0;
    for (let k = 0; k < keys.length; k++) {
      const v = keyAmount(data[i * 3], data[i * 3 + 1], data[i * 3 + 2], k);
      if (v > bv) {
        bv = v;
        best = k;
      }
    }
    amount[i] = bv;
    if (bv >= 0.8) owner[i] = best; // solid key
  }
  // Grow each solid area through pixels that still hold some of the same key.
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) if (owner[i] >= 0) queue[qt++] = i;
  while (qh < qt) {
    const i = queue[qh++];
    const k = owner[i];
    const x = i % width;
    const nb = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
    for (const j of nb) {
      if (j < 0 || j >= n || owner[j] >= 0) continue;
      const v = keyAmount(data[j * 3], data[j * 3 + 1], data[j * 3 + 2], k);
      if (v < 0.04) continue;
      owner[j] = k;
      amount[j] = v;
      queue[qt++] = j;
    }
  }
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    const k = owner[i];
    if (k < 0) {
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
      continue;
    }
    const a = amount[i] >= 0.8 ? 1 : amount[i];
    masks[k][i] = Math.round(a * 255);
    // Un-mix: pixel = a·key + (1 − a)·art, so art = (pixel − a·key) / (1 − a).
    const keep = 1 - a;
    const kc = keys[k];
    const un = (c: number, kv: number) => (keep > 0.08 ? Math.max(0, Math.min(255, Math.round((c - a * kv) / keep))) : 0);
    out[i * 4] = un(r, kc[0]);
    out[i * 4 + 1] = un(g, kc[1]);
    out[i * 4 + 2] = un(b, kc[2]);
    out[i * 4 + 3] = Math.round(keep * 255);
  }
  const areas = masks.map((m) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += m[i];
    return sum / 255 / n;
  });
  // Specks (a stray green pixel in a leaf) aren't photo areas: under 0.5% of the poster is dropped.
  areas.forEach((a, k) => {
    if (a >= 0.005) return;
    for (let i = 0; i < n; i++) {
      if (owner[i] === k) {
        out[i * 4] = data[i * 3];
        out[i * 4 + 1] = data[i * 3 + 1];
        out[i * 4 + 2] = data[i * 3 + 2];
        out[i * 4 + 3] = 255;
        masks[k][i] = 0;
      }
    }
    areas[k] = 0;
  });
  const artPng = await sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 8 }).toBuffer();
  return { width, height, masks, areas, artPng };
}

export interface Placement {
  /** The whole real photo's box on the concept, in percent (can reach past the edges). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** How well the real photo matched the concept there (-1..1); 0 when it was placed by its subject. */
  score: number;
  matched: boolean;
}

const SMALL = 160;

async function grey(buf: Buffer, w: number, h: number): Promise<Float32Array> {
  const { data } = await sharp(buf).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from(data);
}

/**
 * Where the real photo sits on the concept: its box (percent of the concept) so that it covers the
 * photo's shape and lines up with what the image model drew there. The search runs on small
 * greyscale copies: scale from "just covers the shape" up to 2.2×, every offset that still covers
 * it; scored by normalised cross-correlation inside the shape.
 */
export async function placePhoto(o: {
  concept: Buffer;
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  photo: Buffer;
  photoWidth: number;
  photoHeight: number;
  focal?: { x: number; y: number };
}): Promise<Placement | null> {
  const cw = SMALL;
  const ch = Math.round((SMALL * o.maskHeight) / o.maskWidth);
  // The shape, small.
  const m = new Uint8Array(cw * ch);
  let minX = cw;
  let minY = ch;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(o.maskWidth - 1, Math.floor(((x + 0.5) * o.maskWidth) / cw));
      const sy = Math.min(o.maskHeight - 1, Math.floor(((y + 0.5) * o.maskHeight) / ch));
      if (o.mask[sy * o.maskWidth + sx] > 128) {
        m[y * cw + x] = 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const aspect = o.photoWidth / o.photoHeight;
  const toPct = (x: number, y: number, w: number, h: number, score: number, matched: boolean): Placement => ({
    x: (x / cw) * 100,
    y: (y / ch) * 100,
    w: (w / cw) * 100,
    h: (h / ch) * 100,
    score,
    matched
  });
  const minW = Math.max(bw, bh * aspect);

  // Sample points inside the shape (up to ~1,500), with the concept's values there.
  const pts: number[] = [];
  for (let i = 0; i < m.length; i++) if (m[i]) pts.push(i);
  const stride = Math.max(1, Math.floor(pts.length / 1500));
  const sample = pts.filter((_, i) => i % stride === 0);
  const concept = await grey(o.concept, cw, ch);
  const cv = sample.map((i) => concept[i]);
  const cMean = cv.reduce((a, b) => a + b, 0) / cv.length;
  const cDev = cv.map((v) => v - cMean);
  const cNorm = Math.sqrt(cDev.reduce((a, b) => a + b * b, 0)) || 1;

  let best = { score: -2, x: 0, y: 0, w: minW, h: minW / aspect };
  const tryScale = async (dw: number, step: number, around?: { x: number; y: number }) => {
    const pw = Math.max(2, Math.round(dw));
    const ph = Math.max(2, Math.round(dw / aspect));
    const photo = await grey(o.photo, pw, ph);
    const x0 = maxX + 1 - pw;
    const x1 = minX;
    const y0 = maxY + 1 - ph;
    const y1 = minY;
    const xs = around ? [around.x - 2, around.x + 2] : [x0, x1];
    const ys = around ? [around.y - 2, around.y + 2] : [y0, y1];
    for (let oy = Math.max(y0, ys[0]); oy <= Math.min(y1, ys[1]); oy += step) {
      for (let ox = Math.max(x0, xs[0]); ox <= Math.min(x1, xs[1]); ox += step) {
        let sum = 0;
        let sum2 = 0;
        let dot = 0;
        for (let k = 0; k < sample.length; k++) {
          const i = sample[k];
          const px = (i % cw) - ox;
          const py = Math.floor(i / cw) - oy;
          const v = photo[py * pw + px];
          sum += v;
          sum2 += v * v;
          dot += v * cDev[k];
        }
        const mean = sum / sample.length;
        const pNorm = Math.sqrt(Math.max(1e-6, sum2 - sample.length * mean * mean));
        const score = dot / (pNorm * cNorm);
        if (score > best.score) best = { score, x: ox, y: oy, w: pw, h: ph };
      }
    }
  };
  for (let i = 0; i <= 20; i++) await tryScale(minW * (1 + 0.06 * i), 2);
  // Refine around the best, one pixel at a time and a little bigger and smaller.
  const coarse = { ...best };
  for (const f of [0.97, 1, 1.03]) await tryScale(coarse.w * f, 1, { x: coarse.x, y: coarse.y });

  // A small bleed so rounding never leaves a hairline of the shape uncovered.
  const grow = (x: number, y: number, w: number, h: number) => [x - w * 0.012, y - h * 0.012, w * 1.024, h * 1.024] as const;
  if (best.score >= 0.25) {
    const [x, y, w, h] = grow(best.x, best.y, best.w, best.h);
    return toPct(x, y, w, h, Math.round(best.score * 100) / 100, true);
  }
  // A weak match: cover the shape, the photo's subject at the shape's centre.
  const f = o.focal || { x: 0.5, y: 0.45 };
  const w = minW;
  const h = minW / aspect;
  const cx = minX + bw / 2;
  const cy = minY + bh / 2;
  const x = Math.min(minX, Math.max(maxX + 1 - w, cx - f.x * w));
  const y = Math.min(minY, Math.max(maxY + 1 - h, cy - f.y * h));
  const [gx, gy, gw, gh] = grow(x, y, w, h);
  return toPct(gx, gy, gw, gh, 0, false);
}
