/**
 * The pure rules of a post's picture (Post v2): sizes, where the logo goes, and the words sent to
 * the image AI. No database or network here, so it is tested in scripts/postsSelfTest.ts.
 */

export type PictureFormat = 'square' | 'portrait' | 'landscape';
export type LogoCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type ReferenceRole = 'include' | 'style';

export const PICTURE_FORMATS: PictureFormat[] = ['square', 'portrait', 'landscape'];
export const LOGO_CORNERS: LogoCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const REFERENCE_ROLES: ReferenceRole[] = ['include', 'style'];

/**
 * What each format is asked for and what it is saved as. Portrait is 4:5 (the tallest Instagram
 * shows in the feed): the AI makes 2:3 and the top and bottom are trimmed.
 */
export const FORMAT_SIZES: Record<PictureFormat, { api: '1024x1024' | '1024x1536' | '1536x1024'; width: number; height: number; label: string }> = {
  square: { api: '1024x1024', width: 1024, height: 1024, label: 'Square (1:1)' },
  portrait: { api: '1024x1536', width: 1024, height: 1280, label: 'Portrait (4:5)' },
  landscape: { api: '1536x1024', width: 1536, height: 1024, label: 'Landscape (3:2)' }
};

export const isFormat = (v: unknown): v is PictureFormat => typeof v === 'string' && (PICTURE_FORMATS as string[]).includes(v);
export const isCorner = (v: unknown): v is LogoCorner => typeof v === 'string' && (LOGO_CORNERS as string[]).includes(v);
export const isRole = (v: unknown): v is ReferenceRole => typeof v === 'string' && (REFERENCE_ROLES as string[]).includes(v);

/** The AI size closest to a picture's shape (used when changing a picture of any size). */
export function apiSizeFor(width: number, height: number): '1024x1024' | '1024x1536' | '1536x1024' {
  if (!width || !height) return '1024x1024';
  const ratio = width / height;
  if (ratio >= 1.2) return '1536x1024';
  if (ratio <= 0.83) return '1024x1536';
  return '1024x1024';
}

/** The format closest to a picture's shape. */
export function formatOf(width: number, height: number): PictureFormat {
  const api = apiSizeFor(width, height);
  return api === '1536x1024' ? 'landscape' : api === '1024x1536' ? 'portrait' : 'square';
}

/**
 * Where the logo goes: at most 18% of the width and 12% of the height (keeping its shape), with a
 * margin of 4% of the shorter side. Whole pixels, always inside the picture.
 */
export function logoBox(
  imageWidth: number,
  imageHeight: number,
  logoWidth: number,
  logoHeight: number,
  corner: LogoCorner
): { left: number; top: number; width: number; height: number } {
  const maxW = imageWidth * 0.18;
  const maxH = imageHeight * 0.12;
  const scale = Math.min(maxW / Math.max(1, logoWidth), maxH / Math.max(1, logoHeight));
  const width = Math.max(1, Math.round(logoWidth * scale));
  const height = Math.max(1, Math.round(logoHeight * scale));
  const margin = Math.round(Math.min(imageWidth, imageHeight) * 0.04);
  const left = corner.endsWith('left') ? margin : imageWidth - width - margin;
  const top = corner.startsWith('top') ? margin : imageHeight - height - margin;
  return { left: Math.max(0, left), top: Math.max(0, top), width, height };
}

const CORNER_WORDS: Record<LogoCorner, string> = {
  'top-left': 'top-left',
  'top-right': 'top-right',
  'bottom-left': 'bottom-left',
  'bottom-right': 'bottom-right'
};

export interface PictureBrand {
  companyName?: string;
  sector?: string;
  about?: string;
  productsServices?: string;
  brandTone?: string;
  audienceProfile?: string;
  globalRules?: string;
  brandGuidelines?: string;
}

export interface PictureCampaign {
  name?: string;
  description?: string;
  coreMessages?: string;
  goals?: string[];
}

/** The reference pictures, as described to the AI (they are attached in this order). */
export function referenceNotes(refs: { role: ReferenceRole; name?: string }[]): string {
  if (!refs.length) return '';
  return refs
    .map((r, i) => {
      const n = i + 1;
      const label = r.name ? ` (“${r.name.replace(/\s+/g, ' ').slice(0, 60)}”)` : '';
      return r.role === 'style'
        ? `Picture ${n}${label}: STYLE ONLY. Follow its layout, colour palette, lighting, typography style and mood. Do NOT copy its words, logos, brand names, people or products.`
        : `Picture ${n}${label}: INCLUDE THIS. Show this exact subject (product, place or person) faithfully: same shape, colours, labels and details. Do not redesign it.`;
    })
    .join('\n');
}

function lines(entries: [string, string | undefined][]): string {
  return entries
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join('\n');
}

export function brandText(brand?: PictureBrand | null): string {
  if (!brand) return 'Not given.';
  return (
    lines([
      ['Name', brand.companyName],
      ['Sector', brand.sector],
      ['About', brand.about],
      ['Products and services', brand.productsServices],
      ['Tone', brand.brandTone],
      ['Audience', brand.audienceProfile],
      ['Rules', brand.globalRules],
      ['Visual guidelines', brand.brandGuidelines]
    ]) || 'Not given.'
  );
}

export function campaignText(campaign?: PictureCampaign | null): string {
  if (!campaign) return 'None (everyday content).';
  return (
    lines([
      ['Name', campaign.name],
      ['About', campaign.description],
      ['Key messages', campaign.coreMessages],
      ['Goals', Array.isArray(campaign.goals) ? campaign.goals.join('; ') : undefined]
    ]) || 'None (everyday content).'
  );
}

export function logoNote(corner: LogoCorner | null | undefined): string {
  if (!corner) return 'Do not add any logo, watermark or brand mark.';
  return `The brand's real logo will be placed afterwards in the ${CORNER_WORDS[corner]} corner. Keep that corner calm and free of text and important detail (about a fifth of the width). Do not draw any logo, watermark or brand mark yourself.`;
}

export function formatNote(format: PictureFormat): string {
  if (format === 'portrait') return 'Portrait. The top and bottom edges will be trimmed slightly, so keep text and key details away from them.';
  if (format === 'landscape') return 'Landscape (3:2).';
  return 'Square (1:1).';
}

/**
 * The built-in words for an AI photo ("Create with AI" › Photo; an admin's "generate-photo" prompt
 * replaces them). Posters with words are made by the design engine, never by the image AI.
 */
export const BUILTIN_CREATE_IMAGE = `Create one finished, high-quality photo-style image for a social media post.

What the post is about:
{brief}

Caption (context only; do not write it on the image):
{caption}

Brand:
{brand}

Campaign:
{campaign}

Attached pictures:
{references}

Format: {format}

Logo: {logoNote}

Rules:
- Make it look professional and on-brand, with one clear focal point.
- No words, letters, numbers, signs with writing, logos or watermarks anywhere in the image: the caption carries the message, and the real logo is added afterwards.
- No borders, frames or mock-ups.`;

/** Every AI photo ends with this, whichever prompt made it. */
export const PHOTO_RULE = 'Important: this is a photo, not a poster. Put no words, letters, numbers, logos or watermarks anywhere in the image.';

/** The command an admin can point at their own prompt for AI photos. */
export const PHOTO_COMMAND = 'generate-photo';

/** The built-in words for "Change image" (an admin's "change-image" prompt replaces them). */
export const BUILTIN_CHANGE_IMAGE = `Edit the attached picture.

Change only this:
{instruction}

Keep everything else exactly the same: the layout, framing, people, products, colours, lighting, style and any text (same words, same spelling, same place).
{logoNote}`;

/** The logo line for "Change image". */
export function changeLogoNote(corner: LogoCorner | null | undefined): string {
  if (!corner) return '';
  return `Leave the ${CORNER_WORDS[corner]} corner as it is: the brand's logo is placed there afterwards.`;
}

/** Fills {name} placeholders (unknown ones are left as they are). */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match));
}

/** Cleans up what people type as a change ("make it bluer", 2,000 characters at most). */
export function cleanInstruction(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
}
