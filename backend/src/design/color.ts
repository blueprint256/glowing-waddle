/**
 * Colour maths for posters: contrast (WCAG), and perceptual mixing and tinting in OKLab/OKLCH so
 * brand tints look like the brand (a lighter Royal Blue stays blue instead of turning grey-purple).
 */

export type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const isHex = (v: unknown): v is string => typeof v === 'string' && parseHex(v) !== null;

export function toHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);

/** WCAG relative luminance (0 black .. 1 white). */
export function luminance(rgb: RGB): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function contrastHex(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  return x && y ? contrast(x, y) : 1;
}

type Lab = [number, number, number];

export function toOklab([r, g, b]: RGB): Lab {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

export function fromOklab([L, a, b]: Lab): RGB {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ];
}

/** Mixes two colours perceptually (t = 0 gives a, 1 gives b). */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  const p = toOklab(x);
  const q = toOklab(y);
  return toHex(fromOklab([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]));
}

/** The same hue at another perceptual lightness (0..1), with chroma scaled down near black/white. */
export function withLightness(hex: string, L: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [L0, a, b] = toOklab(rgb);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const edge = Math.min(L, 1 - L) / Math.max(0.05, Math.min(L0, 1 - L0));
  const C2 = C * Math.min(1, Math.max(0.15, edge));
  return toHex(fromOklab([L, C2 * Math.cos(h), C2 * Math.sin(h)]));
}

export function lightness(hex: string): number {
  const rgb = parseHex(hex);
  return rgb ? toOklab(rgb)[0] : 0.5;
}

/** Whichever of the two text colours reads better on the background. */
export function bestText(bg: string, dark: string, light: string): string {
  return contrastHex(bg, dark) >= contrastHex(bg, light) ? dark : light;
}

export function rgbTriplet(hex: string): string {
  const rgb = parseHex(hex) || [0, 0, 0];
  return `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
}
