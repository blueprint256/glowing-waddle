import fs from 'fs';
import path from 'path';

/**
 * The fonts posters can use. All are bundled in backend/assets/fonts under open licences (SIL Open
 * Font License or Apache 2.0; the licence file sits next to each font), so every server renders the
 * same letters and nothing is fetched from the internet.
 *
 * Brand fonts that are licensed (e.g. Rotary's Frutiger and Sentinel) are not bundled: brand packs
 * use the free substitutes their own guidelines name (Open Sans for Frutiger, Georgia, whose
 * metric-compatible open twin is Gelasio, for Sentinel).
 */

export interface FontFile {
  file: string;
  style: 'normal' | 'italic';
  /** CSS weight range, e.g. "300 800" for a variable font or "700" for a static one. */
  weight: string;
  /** CSS stretch range for width-variable fonts, e.g. "75% 100%". */
  stretch?: string;
}

export interface FontFamily {
  id: string;
  /** The CSS family name used in designs. */
  family: string;
  category: 'sans' | 'serif' | 'display' | 'condensed' | 'script';
  files: FontFile[];
  /** CSS fallbacks. */
  fallback: string;
  note?: string;
}

export const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');

export const FONTS: FontFamily[] = [
  {
    id: 'opensans',
    family: 'Open Sans',
    category: 'sans',
    fallback: 'Arial, sans-serif',
    note: 'Rotary’s free headline font (instead of Frutiger). Has a condensed width (font-stretch 75%).',
    files: [
      { file: 'opensans/OpenSans[wdth,wght].ttf', style: 'normal', weight: '300 800', stretch: '75% 100%' },
      { file: 'opensans/OpenSans-Italic[wdth,wght].ttf', style: 'italic', weight: '300 800', stretch: '75% 100%' }
    ]
  },
  {
    id: 'gelasio',
    family: 'Gelasio',
    category: 'serif',
    fallback: 'Georgia, serif',
    note: 'Metric twin of Georgia: Rotary’s free body font (instead of Sentinel).',
    files: [
      { file: 'gelasio/Gelasio[wght].ttf', style: 'normal', weight: '400 700' },
      { file: 'gelasio/Gelasio-Italic[wght].ttf', style: 'italic', weight: '400 700' }
    ]
  },
  { id: 'inter', family: 'Inter', category: 'sans', fallback: 'Arial, sans-serif', files: [{ file: 'inter/Inter[opsz,wght].ttf', style: 'normal', weight: '100 900' }] },
  {
    id: 'montserrat',
    family: 'Montserrat',
    category: 'sans',
    fallback: 'Arial, sans-serif',
    files: [
      { file: 'montserrat/Montserrat[wght].ttf', style: 'normal', weight: '100 900' },
      { file: 'montserrat/Montserrat-Italic[wght].ttf', style: 'italic', weight: '100 900' }
    ]
  },
  {
    id: 'archivo',
    family: 'Archivo',
    category: 'sans',
    fallback: 'Arial, sans-serif',
    note: 'Width-variable (font-stretch 62–125%): from condensed to wide.',
    files: [{ file: 'archivo/Archivo[wdth,wght].ttf', style: 'normal', weight: '100 900', stretch: '62% 125%' }]
  },
  { id: 'oswald', family: 'Oswald', category: 'condensed', fallback: '"Arial Narrow", sans-serif', files: [{ file: 'oswald/Oswald[wght].ttf', style: 'normal', weight: '200 700' }] },
  { id: 'bebasneue', family: 'Bebas Neue', category: 'display', fallback: '"Arial Narrow", sans-serif', note: 'Capitals only.', files: [{ file: 'bebasneue/BebasNeue-Regular.ttf', style: 'normal', weight: '400' }] },
  {
    id: 'barlowcondensed',
    family: 'Barlow Condensed',
    category: 'condensed',
    fallback: '"Arial Narrow", sans-serif',
    files: [
      { file: 'barlowcondensed/BarlowCondensed-Regular.ttf', style: 'normal', weight: '400' },
      { file: 'barlowcondensed/BarlowCondensed-Medium.ttf', style: 'normal', weight: '500' },
      { file: 'barlowcondensed/BarlowCondensed-SemiBold.ttf', style: 'normal', weight: '600' },
      { file: 'barlowcondensed/BarlowCondensed-Bold.ttf', style: 'normal', weight: '700' },
      { file: 'barlowcondensed/BarlowCondensed-ExtraBold.ttf', style: 'normal', weight: '800' },
      { file: 'barlowcondensed/BarlowCondensed-Black.ttf', style: 'normal', weight: '900' },
      { file: 'barlowcondensed/BarlowCondensed-BoldItalic.ttf', style: 'italic', weight: '700' }
    ]
  },
  {
    id: 'playfairdisplay',
    family: 'Playfair Display',
    category: 'serif',
    fallback: 'Georgia, serif',
    files: [
      { file: 'playfairdisplay/PlayfairDisplay[wght].ttf', style: 'normal', weight: '400 900' },
      { file: 'playfairdisplay/PlayfairDisplay-Italic[wght].ttf', style: 'italic', weight: '400 900' }
    ]
  },
  {
    id: 'fraunces',
    family: 'Fraunces',
    category: 'serif',
    fallback: 'Georgia, serif',
    files: [
      { file: 'fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf', style: 'normal', weight: '100 900' },
      { file: 'fraunces/Fraunces-Italic[SOFT,WONK,opsz,wght].ttf', style: 'italic', weight: '100 900' }
    ]
  },
  {
    id: 'dmserifdisplay',
    family: 'DM Serif Display',
    category: 'serif',
    fallback: 'Georgia, serif',
    files: [
      { file: 'dmserifdisplay/DMSerifDisplay-Regular.ttf', style: 'normal', weight: '400' },
      { file: 'dmserifdisplay/DMSerifDisplay-Italic.ttf', style: 'italic', weight: '400' }
    ]
  },
  {
    id: 'lora',
    family: 'Lora',
    category: 'serif',
    fallback: 'Georgia, serif',
    files: [
      { file: 'lora/Lora[wght].ttf', style: 'normal', weight: '400 700' },
      { file: 'lora/Lora-Italic[wght].ttf', style: 'italic', weight: '400 700' }
    ]
  },
  { id: 'worksans', family: 'Work Sans', category: 'sans', fallback: 'Arial, sans-serif', files: [{ file: 'worksans/WorkSans[wght].ttf', style: 'normal', weight: '100 900' }] },
  { id: 'manrope', family: 'Manrope', category: 'sans', fallback: 'Arial, sans-serif', files: [{ file: 'manrope/Manrope[wght].ttf', style: 'normal', weight: '200 800' }] },
  {
    id: 'permanentmarker',
    family: 'Permanent Marker',
    category: 'script',
    fallback: 'cursive',
    note: 'Marker lettering (Rotary’s People of Action accent font).',
    files: [{ file: 'permanentmarker/PermanentMarker-Regular.ttf', style: 'normal', weight: '400' }]
  }
];

export const FONT_IDS = FONTS.map((f) => f.id);

export function fontById(id: string | undefined | null): FontFamily | undefined {
  return FONTS.find((f) => f.id === id);
}

/** The CSS font-family value for a font id (unknown ids fall back to Open Sans). */
export function fontStack(id: string | undefined | null): string {
  const f = fontById(id) || fontById('opensans')!;
  return `"${f.family}", ${f.fallback}`;
}

/** Address the renderer serves a font file at (never the internet). */
export const fontUrl = (file: string) => `https://design.local/fonts/${encodeURI(file)}`;

/** @font-face rules for the given font ids. */
export function fontFaceCss(ids: string[]): string {
  const wanted = Array.from(new Set(ids.filter(Boolean)));
  return FONTS.filter((f) => wanted.includes(f.id))
    .flatMap((f) =>
      f.files.map(
        (file) =>
          `@font-face{font-family:"${f.family}";src:url("${fontUrl(file.file)}") format("truetype");font-style:${file.style};font-weight:${file.weight};${file.stretch ? `font-stretch:${file.stretch};` : ''}font-display:block;}`
      )
    )
    .join('\n');
}

/** Reads a bundled font file (only files listed in FONTS can be read). */
export function readFontFile(file: string): Buffer | null {
  const known = FONTS.some((f) => f.files.some((x) => x.file === file));
  if (!known) return null;
  const full = path.join(FONT_DIR, file);
  if (!full.startsWith(FONT_DIR)) return null;
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}
