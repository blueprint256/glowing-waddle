import type { FormatId, FormatInfo } from './types';

/**
 * Poster shapes. The canvas is in design pixels; `scale` is the device scale used for the delivered
 * file, so social posts come out at 2160 px wide and print at 300 dpi.
 */
export const FORMATS: Record<FormatId, FormatInfo> = {
  square: { id: 'square', label: 'Square (1:1)', width: 1080, height: 1080, scale: 2 },
  portrait: { id: 'portrait', label: 'Portrait (4:5)', width: 1080, height: 1350, scale: 2 },
  story: { id: 'story', label: 'Story (9:16)', width: 1080, height: 1920, scale: 2 },
  landscape: { id: 'landscape', label: 'Landscape (3:2)', width: 1200, height: 800, scale: 2 },
  a4: { id: 'a4', label: 'A4 print', width: 1240, height: 1754, scale: 2, print: true },
  a3: { id: 'a3', label: 'A3 print', width: 1240, height: 1754, scale: 2.83, print: true }
};

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

export const isFormatId = (v: unknown): v is FormatId => typeof v === 'string' && (FORMAT_IDS as string[]).includes(v);

/** The app's older picture shapes map onto poster formats. */
export function formatForPictureShape(shape: string | undefined): FormatId {
  if (shape === 'landscape') return 'landscape';
  if (shape === 'square') return 'square';
  return 'portrait';
}

/** The OpenAI image size closest to an area's shape (backgrounds are made for the area they fill). */
export function imageSizeForArea(width: number, height: number): '1024x1024' | '1024x1536' | '1536x1024' {
  const ratio = width / Math.max(1, height);
  if (ratio >= 1.2) return '1536x1024';
  if (ratio <= 0.83) return '1024x1536';
  return '1024x1024';
}
