import type { BrandKit, DesignDoc, DesignTemplate, DesignText, DetailLine, FormatId, PhotoSlot, TextField } from './types';

/**
 * Scenes: every poster is a stack of layers the AI plans and code draws (docs/DESIGN_ENGINE.md).
 *
 *   backdrop   art the image model made (its words, logos and photos removed), or a plain colour or
 *              gradient drawn in code
 *   shapes     colour blocks, bands, circles and frames, drawn in code (crisp, editable)
 *   photos     the person's real photos, never redrawn: a frame on the poster (rectangle, rounded,
 *              circle, arch, slanted, organic), the part of the photo shown in it, fades, a colour
 *              tint, and people "breaking out" of the frame (a cut-out of them on top)
 *   text       the real words, fitted to their boxes, in the brand's fonts
 *   logo       the main logo (and campaign logos), with the brand's rules
 *   partners   one strip of partner logos, sized evenly and never outweighing the main logo
 *
 * How a scene is made: the image model designs a concept with the real photos (it composes and
 * treats photos like a designer), Claude reads the concept into a scene (positions, treatments,
 * colours from the brand, the real words from the brief), and the engine draws it, checks it and
 * repairs what the checks find. Positions are percentages of the picture the scene was read on
 * (`aspect`); they're fitted to each poster shape when drawn.
 */

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'ink' | 'paper';
export type TextRole = 'eyebrow' | 'headline' | 'subhead' | 'details' | 'cta' | 'badge' | 'contact';
export type FadeSide = 'left' | 'right' | 'top' | 'bottom' | 'edges';
export type FrameShape = 'rect' | 'rounded' | 'circle' | 'arch' | 'slant-left' | 'slant-right' | 'blob' | 'organic';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeLayer {
  type: 'shape';
  id: string;
  box: Box;
  color: ColorRole;
  opacity: number;
  shape: 'rect' | 'rounded' | 'circle' | 'pill' | 'slant-left' | 'slant-right' | 'arch';
  radius?: number;
  /** Turned by this many degrees (a tilted band). */
  angle?: number;
}

export interface PhotoLayer {
  type: 'photo';
  id: string;
  /** Which of the poster's photos (0-based). */
  photo: number;
  /** Where the photo shows on the poster. */
  frame: Box;
  shape: FrameShape;
  radius?: number;
  /** The part of the photo shown, as the reader saw it (shares of the photo: left, top, width). */
  crop?: { x: number; y: number; w: number };
  /** The whole photo's box on the poster (computed: covers the frame exactly). */
  place?: Box;
  /** Soft edge into what's behind (`also`: more sides with the same size). */
  fade?: { side: FadeSide; size: number; also?: FadeSide[] };
  tint?: { color: ColorRole; amount: number; mode: 'tint' | 'duotone' | 'darken' };
  /** The people stand in front of what's above the photo, past the frame's top (or all edges). */
  breakout?: 'top' | 'all' | null;
  /** Words for the cut-out ("the woman holding the baby"); default "person". */
  subject?: string;
  border?: { color: ColorRole; width: number };
  /** An organic frame's mask (a small PNG as a data URI, white where the photo shows). */
  mask?: string;
}

export interface TextLayer {
  type: 'text';
  id: string;
  role: TextRole;
  box: Box;
  align: 'left' | 'center' | 'right';
  /** A brand colour, or "auto" (light or dark, whichever reads on what's behind). */
  color: ColorRole | 'auto';
  panel?: ColorRole | 'none';
  panelOpacity?: number;
  radius?: number;
  upper?: boolean;
  weight?: 'regular' | 'bold' | 'black';
  font?: 'display' | 'text' | 'accent';
  lines?: number;
}

export interface LogoLayer {
  type: 'logo';
  id: string;
  box: Box;
  align: 'left' | 'center' | 'right';
}

export interface PartnersLayer {
  type: 'partners';
  id: string;
  box: Box;
  align: 'left' | 'center' | 'right';
  panel?: ColorRole | 'none';
  radius?: number;
}

export type SceneLayer = ShapeLayer | PhotoLayer | TextLayer | LogoLayer | PartnersLayer;

export type Backdrop = { kind: 'art' } | { kind: 'color'; color: ColorRole } | { kind: 'gradient'; from: ColorRole; to: ColorRole; angle: number };

export interface Scene {
  version: 2;
  /** Width / height of the picture the positions were read on. */
  aspect: number;
  backdrop: Backdrop;
  /** Back to front. */
  layers: SceneLayer[];
  copy: DesignText;
  /** A note for the person (a weekday that doesn't match its date…). */
  message?: string;
  /** How the poster improves on the concept (for the record and the review). */
  improvements?: string;
}

// ------------------------------------------------------------------------------------- the concept

/** Image sizes the concept and art are made at, by poster shape. */
export const CONCEPT_SIZE: Record<string, string> = {
  portrait: '1024x1536',
  story: '1024x1536',
  a4: '1024x1536',
  a3: '1024x1536',
  square: '1024x1024',
  landscape: '1536x1024'
};

/** Width / height of each poster shape (matches design/formats.ts). */
export const POSTER_ASPECT: Record<string, number> = { square: 1, portrait: 0.8, story: 0.5625, landscape: 1.5, a4: 0.707, a3: 0.707 };

const SHAPE_WORDS: Record<string, string> = {
  portrait: 'a portrait social media poster (4:5)',
  story: 'a tall phone story poster (9:16)',
  square: 'a square social media poster',
  landscape: 'a landscape banner (3:2)',
  a4: 'an A4 portrait flyer',
  a3: 'an A3 portrait poster'
};

export interface ConceptAsk {
  brief: string;
  brandName: string;
  sector?: string;
  colors: Record<ColorRole, string>;
  mood?: string;
  format: FormatId;
  words: { headline: boolean; details: number; cta: boolean; subhead: boolean };
  partners: number;
  otherLogos: number;
  /** How many real photos are attached to the request (the model designs with them). */
  photos: number;
  direction: string;
}

/** One direction per option, so the options differ. With photos, every direction uses them. */
export const DIRECTIONS_WITH_PHOTOS = [
  'Layout: the photograph full-bleed across the whole poster, the words together on one calm area with a soft colour fade behind them. Mood: cinematic and warm.',
  'Layout: split, a solid brand-colour panel holding all the words, the photograph filling the other part edge to edge, straight clean edges. Mood: confident and modern.',
  'Layout: the photograph cut into a bold shape (a circle, an arch or a slanted panel), the people breaking out over its top edge, strong colour blocks and a huge headline. Mood: bold and graphic.',
  'Layout: typography first, a huge headline on a flat colour ground, the photograph cropped tight on the people in a clean frame lower down. Mood: editorial.'
];
export const DIRECTIONS_WITHOUT_PHOTOS = [
  'Layout: graphic and illustrated, shapes, patterns and an illustrated scene in the brand colours, the words on a clean area. Mood: lively and celebratory.',
  'Layout: typography first, a huge headline on a flat colour ground with bold geometric shapes. Mood: bold, graphic, editorial.',
  'Layout: an atmospheric illustrated scene that fits the subject, the words together on a calm area. Mood: warm and inviting.',
  'Layout: a strong split of two brand colours with a large simple symbol of the subject. Mood: modern and clean.'
];

/** The poster may be a little wider or taller than the picture drawn: keep what matters off the trimmed edges. */
function trimNote(format: FormatId): string {
  const [w, h] = (CONCEPT_SIZE[format] || '1024x1536').split('x').map(Number);
  const poster = POSTER_ASPECT[format] || w / h;
  const art = w / h;
  if (Math.abs(poster - art) < 0.02) return '';
  return art < poster
    ? `The top and bottom ${Math.round(((1 - art / poster) / 2) * 100)}% of the picture will be trimmed: keep every text area, logo and face out of them (background only there).`
    : `The left and right ${Math.round(((1 - poster / art) / 2) * 100)}% of the picture will be trimmed: keep every text area, logo and face out of them (background only there).`;
}

/** The words for the image model: what the poster is for, the brand, and the spaces to leave. */
export function conceptPrompt(a: ConceptAsk): string {
  const brief = a.brief.replace(/\n+\s*(Poster facts|Picture):[\s\S]*$/i, '').trim() || a.brief.trim();
  const spaces: string[] = [`the main logo of ${a.brandName || 'the organisation'} (a plain placeholder box, top or bottom)`];
  if (a.otherLogos) spaces.push(`${a.otherLogos} more small logo placeholder${a.otherLogos > 1 ? 's' : ''} beside it`);
  if (a.partners) spaces.push(`a tidy strip of ${a.partners} partner logo placeholders (plain light rounded boxes, equal size) along one edge`);
  const text = [
    a.words.headline ? 'a short, large headline (placeholder words are fine)' : '',
    a.words.subhead ? 'one short supporting line' : '',
    a.words.details ? `${a.words.details} short detail line${a.words.details > 1 ? 's' : ''} (date, time, place)` : '',
    a.words.cta ? 'a call-to-action button' : ''
  ].filter(Boolean);
  const photos = a.photos
    ? [
        `The ${a.photos > 1 ? `${a.photos} attached photographs are` : 'attached photograph is'} the real photography for this poster. Design with ${a.photos > 1 ? 'them' : 'it'} like a professional designer: crop and scale freely, cut ${a.photos > 1 ? 'them' : 'it'} into a shape, let people overlap a frame's edge, fade into a colour field, run panels beside or across parts with no faces.`,
        `Keep each photograph's content as it is: the same people, faces, poses and scene. Never add, remove or replace people, and never change a face. Show each photograph once, as one piece.`
      ].join(' ')
    : 'There is no photograph: no people.';
  return [
    `Design ${SHAPE_WORDS[a.format] || 'a social media poster'} for ${a.brandName || 'an organisation'}${a.sector ? ` (${a.sector})` : ''}.`,
    `What it's about: ${brief.slice(0, 900)}`,
    `Colours: the brand palette ${(['primary', 'secondary', 'accent'] as ColorRole[]).map((r) => a.colors[r]).join(', ')}, with ${a.colors.paper} and ${a.colors.ink} for light and dark.${a.mood ? ` Mood: ${a.mood}.` : ''}`,
    `Direction: ${a.direction}`,
    photos,
    `Text it will carry: ${text.join(', ')}.`,
    `Leave room for: ${spaces.join('; ')}.`,
    trimNote(a.format),
    'Avoid template clichés: no corner swooshes, no wavy stripes along the bottom, no lens flares.',
    'Make it a finished, professional poster: strong composition, clear hierarchy, generous margins. Keep every text and logo area on a calm, simple part of the design. No other brands, no watermark, no mock-up frame or border.'
  ]
    .filter(Boolean)
    .join('\n');
}

/** The backdrop: the concept with its words, logos and photographs removed (only when it has art worth keeping). */
export const BACKDROP_PROMPT =
  'Remove from this poster every word, letter, number, logo, logo placeholder, badge and button, and every photograph together with the people in it. Fill each of those areas with what would naturally continue behind it: the same colour field, gradient, texture, pattern or panel. Keep every illustration, shape, colour area, texture and the lighting exactly as they are. No text of any kind, no people.';

// -------------------------------------------------------------------------------------- the reader

export const SCENE_READER_SYSTEM = `You are a senior designer turning a poster concept into a precise, brand-perfect layered poster. The concept picture was made by an image model (its words and logos are placeholders; its photographs are redrawn from the real ones). You write a scene: layers the engine draws with the real words, logo files, partner logos and the real photos' own pixels.

Layers, back to front (later layers sit on top):
- backdrop: "art" only if the concept has imagery worth keeping behind everything (illustration, texture, scenery, a complex gradient); the engine then keeps the concept's picture with words, logos and photos removed. If the background is flat colour or a simple two-colour gradient, use "color" or "gradient" (crisp, free, editable) and draw its colour blocks as shape layers.
- shape: colour blocks, bands, circles, pills, slanted panels, arches. With a "color"/"gradient" backdrop draw every colour block of the concept as shapes. With "art", only add shapes that must sit in front of a photo (a band across it) or behind words.
- photo: where a real photo shows. frame = the area it fills; shape = rect, rounded, circle, arch, slant-left/slant-right (one slanted side), blob (soft organic), or organic (an irregular cut-out shape the others can't describe); crop = which part of the REAL photo shows in the frame (x, y = its top-left, w = its width, as shares 0–1 of the real photo; look at the real photo given after the concept); fade = soft edges: every side where the photo melts into the colour or art behind it (sides; size in % of the frame) — look closely, a photo often fades on two sides; tint = a brand-colour wash (tint, duotone or darken; amount 0–1); breakout "top" when the concept's people rise above the frame's top edge (heads over a band or panel), "all" when they overlap every edge; subject = a few words for who matters in the photo ("the woman holding the baby"), always: the engine keeps them uncut. A full-bleed photo is a rect frame covering the whole poster (0,0,100,100).
- text: role eyebrow, headline, subhead, details, cta, badge or contact.
- logo: the main logo (always one, at least 6% of the poster's shorter side high, on a calm area).
- partners: one strip for all partner logos in one row (only if partners are given), 8–14% high.

Read the concept's intent and improve on it:
- Keep its composition and its photo treatment (crop, shape, fades, overlaps): that is the design.
- Improve: align to clean edges and a consistent margin (at least 5% from every side for words and logos), make the hierarchy obvious, give words room, keep them off faces and busy areas (add a panel or a fade when needed), keep logos away from clutter.
- Colours only from the brand (primary, secondary, accent, ink, paper). "auto" picks light or dark text for what's behind; prefer it over imagery. Fonts: display for headlines, eyebrows, details, buttons; text only for a longer supporting sentence; accent for a word or two at most.
- Positions are percentages of the concept picture (x, w of its width; y, h of its height). Boxes for words and logos must not overlap each other. A headline box is usually 12–30% of the height; details 3.5–5% per line; the call to action a clear button.
- Words: the real copy from the brief only. Facts exactly as given; never invent dates, places, names, numbers or prices. Headline at most about 8 words. Only fields with something true to say.
- Dates: today's date is given. If a weekday doesn't match its date, or a date has passed, leave the weekday out and say so in "message". Don't correct silently.
- Every real photo the concept shows gets a photo layer; never invent a photo that isn't given.`;

const TEXT_ROLES: TextRole[] = ['eyebrow', 'headline', 'subhead', 'details', 'cta', 'badge', 'contact'];
const COLORS: ColorRole[] = ['primary', 'secondary', 'accent', 'ink', 'paper'];
const FRAMES: FrameShape[] = ['rect', 'rounded', 'circle', 'arch', 'slant-left', 'slant-right', 'blob', 'organic'];
const SHAPES: ShapeLayer['shape'][] = ['rect', 'rounded', 'circle', 'pill', 'slant-left', 'slant-right', 'arch'];

export const SCENE_TOOL = {
  name: 'write_scene',
  description: 'The poster as layers (back to front) and its real words.',
  schema: {
    type: 'object',
    required: ['backdrop', 'layers', 'copy'],
    properties: {
      backdrop: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['art', 'color', 'gradient'] },
          color: { type: 'string', enum: COLORS, description: 'color: the ground; gradient: where it starts' },
          to: { type: 'string', enum: COLORS, description: 'gradient: where it ends' },
          angle: { type: 'number', description: 'gradient direction in degrees (180 = top to bottom)' }
        }
      },
      layers: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'x', 'y', 'w', 'h'],
          properties: {
            type: { type: 'string', enum: ['shape', 'photo', 'text', 'logo', 'partners'] },
            role: { type: 'string', enum: TEXT_ROLES, description: 'text only' },
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
            shape: { type: 'string', enum: [...new Set([...FRAMES, ...SHAPES])] },
            radius: { type: 'number', description: 'corner rounding, % of the shorter side (50 = pill)' },
            angle: { type: 'number', description: 'shape: rotation in degrees' },
            color: { type: 'string', enum: [...COLORS, 'auto'] },
            opacity: { type: 'number' },
            align: { type: 'string', enum: ['left', 'center', 'right'] },
            panel: { type: 'string', enum: [...COLORS, 'none'] },
            panelOpacity: { type: 'number' },
            upper: { type: 'boolean' },
            weight: { type: 'string', enum: ['regular', 'bold', 'black'] },
            font: { type: 'string', enum: ['display', 'text', 'accent'] },
            lines: { type: 'integer' },
            photo: { type: 'integer', description: 'photo: which real photo (1 = the first)' },
            crop: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' } } },
            fade: {
              type: 'object',
              description: 'soft edges: every side where the photo melts into what is behind it',
              properties: { sides: { type: 'array', items: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'edges'] } }, size: { type: 'number' } }
            },
            tint: { type: 'object', properties: { color: { type: 'string', enum: COLORS }, amount: { type: 'number' }, mode: { type: 'string', enum: ['tint', 'duotone', 'darken'] } } },
            breakout: { type: 'string', enum: ['top', 'all', 'none'] },
            subject: { type: 'string' },
            border: { type: 'object', properties: { color: { type: 'string', enum: COLORS }, width: { type: 'number' } } }
          }
        }
      },
      copy: {
        type: 'object',
        properties: {
          eyebrow: { type: 'string' },
          headline: { type: 'string' },
          subhead: { type: 'string' },
          details: { type: 'array', items: { type: 'object', required: ['kind', 'text'], properties: { kind: { type: 'string', enum: ['date', 'time', 'place', 'phone', 'web', 'info'] }, text: { type: 'string' } } } },
          cta: { type: 'string' },
          badge: { type: 'object', properties: { top: { type: 'string' }, main: { type: 'string' }, bottom: { type: 'string' } } },
          sponsorsTitle: { type: 'string' }
        }
      },
      improvements: { type: 'string' },
      message: { type: 'string', description: 'A short note to the person about anything to check. Empty if nothing.' }
    }
  }
};

export function sceneReaderPrompt(o: { brief: string; brand: string; partners: string[]; otherLogos: number; photos: number; format: FormatId; today?: Date }): string {
  const today = (o.today || new Date()).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return [
    `Today is ${today}. Poster shape: ${o.format}.`,
    `Brief:\n${o.brief.slice(0, 2500)}`,
    o.brand,
    `Real content: the main logo${o.otherLogos ? ` and ${o.otherLogos} other logo${o.otherLogos > 1 ? 's' : ''}` : ''}; ${o.partners.length ? `${o.partners.length} partner logos (${o.partners.join(', ')})` : 'no partners'}; ${o.photos ? `${o.photos} real photo${o.photos > 1 ? 's' : ''} (shown after the concept, in order)` : 'no real photo'}.`,
    'The first picture is the concept. Write the scene.'
  ].join('\n\n');
}

// ------------------------------------------------------------------------------------- cleaning up

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && isFinite(v) ? v : d;
  return Math.max(lo, Math.min(hi, n));
};
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** A box kept on the canvas (photos and shapes may bleed off by up to half their size). */
function boxOf(r: any, bleed: boolean): Box {
  if (bleed) {
    const w = num(r.w, 2, 200, 50);
    const h = num(r.h, 2, 200, 50);
    return { x: num(r.x, -w / 2, 100, 0), y: num(r.y, -h / 2, 100, 0), w, h };
  }
  const x = num(r.x, 0, 96, 6);
  const y = num(r.y, 0, 96, 6);
  return { x, y, w: num(r.w, 3, 100 - x, 40), h: num(r.h, 2, 100 - y, 10) };
}

export function cleanCopy(c: any): DesignText {
  const copy: DesignText = { headline: str(c?.headline, 90) || 'Join us' };
  if (str(c?.eyebrow, 50)) copy.eyebrow = str(c.eyebrow, 50);
  if (str(c?.subhead, 200)) copy.subhead = str(c.subhead, 200);
  if (str(c?.cta, 50)) copy.cta = str(c.cta, 50);
  if (str(c?.sponsorsTitle, 40)) copy.sponsorsTitle = str(c.sponsorsTitle, 40);
  if (str(c?.social, 40)) copy.social = str(c.social, 40);
  if (str(c?.web, 60)) copy.web = str(c.web, 60);
  if (Array.isArray(c?.details)) {
    const details: DetailLine[] = c.details
      .filter((d: any) => d && typeof d.text === 'string' && d.text.trim())
      .slice(0, 4)
      .map((d: any) => ({ kind: pick(d.kind, ['date', 'time', 'place', 'phone', 'web', 'info'] as const, 'info'), text: d.text.trim().slice(0, 90) }));
    if (details.length) copy.details = details;
  }
  if (c?.badge && typeof c.badge === 'object' && str(c.badge.main, 12)) copy.badge = { top: str(c.badge.top, 12), main: str(c.badge.main, 12)!, bottom: str(c.badge.bottom, 12) };
  return copy;
}

/**
 * Cleans what the reader wrote: known layer types, boxes on the canvas, one logo, one partner
 * strip (only with partners), photos only for photos that exist, text only where there are words.
 */
export function cleanScene(raw: any, opts: { partners: number; photos: number; aspect: number }): Scene {
  const copy = cleanCopy(raw?.copy);
  const has: Record<TextRole, boolean> = {
    headline: true,
    eyebrow: !!copy.eyebrow,
    subhead: !!copy.subhead,
    details: !!copy.details?.length,
    cta: !!copy.cta,
    badge: !!copy.badge,
    contact: true
  };
  const layers: SceneLayer[] = [];
  const seenText = new Set<TextRole>();
  const seenPhoto = new Set<number>();
  let logo = false;
  let partners = false;
  let n = 0;
  const id = (t: string) => `${t}${++n}`;
  for (const r of Array.isArray(raw?.layers) ? raw.layers : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'shape') {
      layers.push({
        type: 'shape',
        id: id('s'),
        box: boxOf(r, true),
        color: pick(r.color, COLORS, 'primary'),
        opacity: num(r.opacity, 0.05, 1, 1),
        shape: pick(r.shape, SHAPES, 'rect'),
        radius: num(r.radius, 0, 50, 0),
        angle: num(r.angle, -45, 45, 0)
      });
    } else if (r.type === 'photo') {
      const index = Math.round(num(r.photo, 1, 12, 1)) - 1;
      if (index >= opts.photos || seenPhoto.has(index)) continue;
      seenPhoto.add(index);
      const crop = r.crop && typeof r.crop === 'object' ? { x: num(r.crop.x, 0, 0.95, 0), y: num(r.crop.y, 0, 0.95, 0), w: num(r.crop.w, 0.05, 1, 1) } : undefined;
      const SIDES = ['left', 'right', 'top', 'bottom', 'edges'] as const;
      const fadeSides: FadeSide[] =
        r.fade && typeof r.fade === 'object' ? Array.from(new Set<FadeSide>((Array.isArray(r.fade.sides) ? r.fade.sides : [r.fade.side]).filter((x: any) => SIDES.includes(x)))) : [];
      const breakout = r.breakout === 'top' || r.breakout === 'all' ? r.breakout : null;
      layers.push({
        type: 'photo',
        id: id('p'),
        photo: index,
        frame: boxOf(r, true),
        shape: pick(r.shape, FRAMES, 'rect'),
        radius: num(r.radius, 0, 50, 0),
        crop,
        fade: fadeSides.length ? { side: fadeSides[0], size: num(r.fade.size, 5, 70, 25), also: fadeSides.length > 1 ? fadeSides.slice(1) : undefined } : undefined,
        tint: r.tint && typeof r.tint === 'object' && r.tint.color ? { color: pick(r.tint.color, COLORS, 'primary'), amount: num(r.tint.amount, 0, 0.9, 0.35), mode: pick(r.tint.mode, ['tint', 'duotone', 'darken'] as const, 'tint') } : undefined,
        breakout,
        subject: str(r.subject, 120),
        border: r.border && typeof r.border === 'object' && r.border.color ? { color: pick(r.border.color, COLORS, 'paper'), width: num(r.border.width, 0.2, 3, 0.8) } : undefined
      });
    } else if (r.type === 'text') {
      const role = pick(r.role, TEXT_ROLES, 'headline');
      if (!TEXT_ROLES.includes(r.role) || seenText.has(role) || !has[role]) continue;
      seenText.add(role);
      layers.push({
        type: 'text',
        id: role,
        role,
        box: boxOf(r, false),
        align: pick(r.align, ['left', 'center', 'right'] as const, 'left'),
        color: pick(r.color, [...COLORS, 'auto'] as const, 'auto') as ColorRole | 'auto',
        panel: pick(r.panel, [...COLORS, 'none'] as const, 'none') as ColorRole | 'none',
        panelOpacity: num(r.panelOpacity, 0, 1, 1),
        radius: num(r.radius, 0, 50, 0),
        upper: Boolean(r.upper),
        weight: pick(r.weight, ['regular', 'bold', 'black'] as const, role === 'headline' ? 'black' : role === 'cta' || role === 'eyebrow' || role === 'details' ? 'bold' : 'regular'),
        font: pick(r.font, ['display', 'text', 'accent'] as const, role === 'subhead' ? 'text' : 'display'),
        lines: Math.round(num(r.lines, 1, 8, role === 'headline' ? 3 : role === 'subhead' ? 3 : 2))
      });
    } else if (r.type === 'logo' && !logo) {
      logo = true;
      layers.push({ type: 'logo', id: 'logo', box: boxOf(r, false), align: pick(r.align, ['left', 'center', 'right'] as const, 'left') });
    } else if (r.type === 'partners' && !partners && opts.partners) {
      partners = true;
      layers.push({ type: 'partners', id: 'partners', box: boxOf(r, false), align: pick(r.align, ['left', 'center', 'right'] as const, 'center'), panel: pick(r.panel, [...COLORS, 'none'] as const, 'none') as ColorRole | 'none', radius: num(r.radius, 0, 50, 0) });
    }
  }
  // Never without a headline, the main logo, or the partners that were asked for.
  if (!seenText.has('headline')) layers.push({ type: 'text', id: 'headline', role: 'headline', box: { x: 6, y: 8, w: 88, h: 22 }, align: 'left', color: 'auto', panel: 'none', weight: 'black', font: 'display', lines: 3 });
  if (!logo) layers.push({ type: 'logo', id: 'logo', box: { x: 6, y: 4, w: 30, h: 7 }, align: 'left' });
  if (opts.partners && !partners) layers.push({ type: 'partners', id: 'partners', box: { x: 6, y: 86, w: 88, h: 10 }, align: 'center', panel: 'paper', radius: 8 });
  // Photos and shapes behind words and logos: whatever order the reader gave, text and logos go last.
  const back = layers.filter((l) => l.type === 'shape' || l.type === 'photo');
  const front = layers.filter((l) => l.type !== 'shape' && l.type !== 'photo');
  const b = raw?.backdrop || {};
  const kind = pick(b.kind, ['art', 'color', 'gradient'] as const, 'art');
  const backdrop: Backdrop =
    kind === 'color' ? { kind, color: pick(b.color, COLORS, 'paper') } : kind === 'gradient' ? { kind, from: pick(b.color, COLORS, 'primary'), to: pick(b.to, COLORS, 'secondary'), angle: num(b.angle, 0, 360, 180) } : { kind: 'art' };
  return { version: 2, aspect: opts.aspect, backdrop, layers: [...back, ...front], copy, message: str(raw?.message, 300), improvements: str(raw?.improvements, 400) };
}

// ------------------------------------------------------------------------------------- photo place

/**
 * The whole photo's box on the canvas so that `crop` (the part of the photo the reader saw) fills
 * the frame, or, without a crop, so the photo covers the frame around its subject. Always covers
 * the frame. Boxes in % of the canvas; `aspect` is the canvas's width / height.
 */
export function placeFromCrop(frame: Box, canvasAspect: number, photo: { width: number; height: number; focal?: { x: number; y: number } }, crop?: { x: number; y: number; w: number }): Box {
  const pa = photo.width / photo.height;
  const fw = (frame.w / 100) * canvasAspect;
  const fh = frame.h / 100;
  const fx = (frame.x / 100) * canvasAspect;
  const fy = frame.y / 100;
  let pw = Math.max(fw / (crop?.w || 1), fh * pa, fw);
  if (!crop) pw = Math.max(fw, fh * pa);
  const ph = pw / pa;
  const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let left: number;
  let top: number;
  if (crop) {
    left = fx - crop.x * pw;
    top = fy - crop.y * ph;
  } else {
    const f = photo.focal || { x: 0.5, y: 0.45 };
    left = fx + fw / 2 - f.x * pw;
    top = fy + fh * 0.42 - f.y * ph;
  }
  left = clampTo(left, fx + fw - pw, fx);
  top = clampTo(top, fy + fh - ph, fy);
  return { x: (left / canvasAspect) * 100, y: top * 100, w: (pw / canvasAspect) * 100, h: ph * 100 };
}

/** Makes a placement cover the frame (after edits or repairs moved things). */
export function coverFrame(place: Box, frame: Box, canvasAspect: number, photoAspect: number): Box {
  let w = Math.max(place.w, frame.w, (frame.h / 100) * photoAspect / canvasAspect * 100);
  let h = (w / 100) * canvasAspect / photoAspect * 100;
  if (h < frame.h) {
    h = frame.h;
    w = (h / 100) * photoAspect / canvasAspect * 100;
  }
  const cx = place.x + place.w / 2;
  const cy = place.y + place.h / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = Math.max(frame.x + frame.w - w, Math.min(frame.x, x));
  y = Math.max(frame.y + frame.h - h, Math.min(frame.y, y));
  return { x, y, w, h };
}

// ------------------------------------------------------------------------------- fit to the poster

/**
 * The scene's canvas is shown "cover" on the poster (like its art): a part of it is trimmed when
 * the shapes differ. Boxes move to where that part lands; words and logos in a trimmed edge are
 * pulled inside a small margin; photos and shapes keep bleeding.
 */
export function fitBox(b: Box, canvasAspect: number, posterAspect: number, bleed: boolean): Box {
  if (!canvasAspect || Math.abs(canvasAspect - posterAspect) < 0.01) return { ...b };
  const taller = canvasAspect < posterAspect;
  const v = taller ? canvasAspect / posterAspect : posterAspect / canvasAspect;
  const off = ((1 - v) / 2) * 100;
  const m = 3;
  const map = (pos: number, size: number): [number, number] => {
    let p = (pos - off) / v;
    let sz = size / v;
    if (bleed) return [p, sz];
    if (p < m) {
      sz = Math.max(2, sz - (m - p));
      p = m;
    }
    if (p + sz > 100 - m) {
      const over = p + sz - (100 - m);
      p = Math.max(m, p - over);
      sz = Math.min(sz, 100 - m - p);
    }
    return [p, sz];
  };
  const out = { ...b };
  if (taller) [out.y, out.h] = map(b.y, b.h);
  else [out.x, out.w] = map(b.x, b.w);
  return out;
}

// --------------------------------------------------------------------------------------- drawing

/** Text sizes per role (hundredths of the poster's short side) and the field each shows. */
const TEXT_ROLE: Partial<Record<TextRole, { field: TextField; min: number; max: number; order: number; tag: string }>> = {
  headline: { field: 'headline', min: 4.2, max: 16, order: 1, tag: 'h1' },
  subhead: { field: 'subhead', min: 2.6, max: 5, order: 2, tag: 'p' },
  eyebrow: { field: 'eyebrow', min: 2.1, max: 3.4, order: 4, tag: 'p' },
  cta: { field: 'cta', min: 2.5, max: 4, order: 3, tag: 'p' }
};

const colorVar = (c: ColorRole) => `var(--c-${c})`;
const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
const boxCss = (b: Box) => `left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)};`;

function frameClip(shape: FrameShape | ShapeLayer['shape'], radius = 0, minSide = 1): string {
  switch (shape) {
    case 'rounded':
      return `border-radius:${Math.max(4, radius) / 100 * minSide * 2}cqmin;`;
    case 'pill':
      return 'border-radius:999px;';
    case 'circle':
      return 'border-radius:50%;';
    case 'arch':
      return 'border-radius:50% 50% 0 0 / 34% 34% 0 0;';
    case 'blob':
      return 'border-radius:42% 58% 55% 45% / 48% 40% 60% 52%;';
    case 'slant-left':
      return 'clip-path:polygon(18% 0,100% 0,100% 100%,0 100%);';
    case 'slant-right':
      return 'clip-path:polygon(0 0,100% 0,82% 100%,0 100%);';
    default:
      return radius ? `border-radius:${radius / 100 * minSide * 2}cqmin;` : '';
  }
}

/** Sides a photo fades on. */
export const fadeSides = (f?: PhotoLayer['fade']): FadeSide[] => (f ? [f.side, ...(f.also || [])] : []);

function fadeMask(f: PhotoLayer['fade']): string {
  if (!f) return '';
  const s = Math.max(5, Math.min(70, f.size));
  const one = (side: FadeSide) =>
    side === 'edges'
      ? `radial-gradient(ellipse at center, #000 ${100 - s * 1.4}%, transparent 100%)`
      : `linear-gradient(${{ left: 'to right', right: 'to left', top: 'to bottom', bottom: 'to top' }[side]}, transparent 0, #000 ${s}%)`;
  const sides = Array.from(new Set(fadeSides(f)));
  const g = sides.map(one).join(', ');
  // Several sides: each gradient keeps its own edge soft (intersected).
  const compose = sides.length > 1 ? `-webkit-mask-composite:source-in;mask-composite:intersect;` : '';
  return `-webkit-mask-image:${g};mask-image:${g};${compose}`;
}

/** The scene as the runtime draws it, fitted to one poster shape. */
export type PhotoInfo = { width: number; height: number; focal?: { x: number; y: number }; cutout?: PhotoSlot['cutout'] };

export function sceneTemplate(scene: Scene, id: string, format: FormatId, photos: PhotoInfo[] = []): DesignTemplate {
  const pa = POSTER_ASPECT[format] || 0.8;
  const fit = (b: Box, bleed: boolean) => fitBox(b, scene.aspect, pa, bleed);
  const parts: string[] = [];
  const css: string[] = [
    `#poster { background: var(--c-paper); }`,
    `.sc-l { position: absolute; box-sizing: border-box; }`,
    `.sc-r { position: absolute; display: flex; flex-direction: column; justify-content: center; overflow: hidden; box-sizing: border-box; }`,
    `.sc-r > * { margin: 0; }`
  ];
  const bd = scene.backdrop;
  if (bd.kind === 'art') parts.push('<div class="sc-art d-fill" data-bg></div>'), css.push('.sc-art { position: absolute; inset: 0; }');
  else if (bd.kind === 'color') css.push(`#poster { background: ${colorVar(bd.color)}; }`);
  else css.push(`#poster { background: linear-gradient(${Math.round(bd.angle)}deg, ${colorVar(bd.from)}, ${colorVar(bd.to)}); }`);

  const breakouts: { layer: PhotoLayer; frame: Box; place: Box }[] = [];
  const logoLayer = scene.layers.find((l) => l.type === 'logo');
  const logoH = logoLayer ? fit(logoLayer.box, false).h : 8;
  const details = scene.copy.details?.length || 2;
  let k = 0;
  for (const layer of scene.layers) {
    const c = `sc-${++k}`;
    if (layer.type === 'shape') {
      const b = fit(layer.box, true);
      const rot = layer.angle ? `transform:rotate(${layer.angle}deg);` : '';
      parts.push(`<div class="sc-l ${c}" aria-hidden="true"></div>`);
      css.push(`.${c} { ${boxCss(b)} background: ${colorVar(layer.color)}; opacity: ${layer.opacity}; ${frameClip(layer.shape, layer.radius, Math.min(b.w, b.h))} ${rot} pointer-events: none; }`);
    } else if (layer.type === 'photo') {
      const frame = fit(layer.frame, true);
      const p = photos[layer.photo];
      const place0 = layer.place || (p ? placeFromCrop(layer.frame, scene.aspect, p, layer.crop) : layer.frame);
      const place = fit(place0, true);
      // The photo's own box, inside its frame (in % of the frame).
      const inner = { x: ((place.x - frame.x) / frame.w) * 100, y: ((place.y - frame.y) / frame.h) * 100, w: (place.w / frame.w) * 100, h: (place.h / frame.h) * 100 };
      const mask = layer.shape === 'organic' && layer.mask ? `-webkit-mask-image:url("${layer.mask}");mask-image:url("${layer.mask}");-webkit-mask-size:100% 100%;mask-size:100% 100%;` : fadeMask(layer.fade);
      const border = layer.border ? `outline:${layer.border.width}cqmin solid ${colorVar(layer.border.color)};outline-offset:-${layer.border.width}cqmin;` : '';
      parts.push(`<div class="sc-l ${c}" data-frame><div class="sc-pl" data-photo="${layer.photo + 1}" style="position:absolute;${boxCss(inner)}"></div>${layer.tint ? `<div class="sc-tint ${c}-t" aria-hidden="true"></div>` : ''}</div>`);
      css.push(`.${c} { ${boxCss(frame)} overflow: hidden; ${frameClip(layer.shape, layer.radius, Math.min(frame.w, frame.h))} ${mask} ${border} }`);
      if (layer.tint) {
        const t = layer.tint;
        const blend = t.mode === 'duotone' ? 'color' : t.mode === 'darken' ? 'multiply' : 'soft-light';
        css.push(`.${c}-t { position: absolute; inset: 0; background: ${colorVar(t.color)}; opacity: ${t.amount}; mix-blend-mode: ${blend}; pointer-events: none; }`);
        if (t.mode === 'duotone') css.push(`.${c} img { filter: grayscale(1) contrast(1.08); }`);
      }
      if (layer.breakout) breakouts.push({ layer, frame, place });
    } else if (layer.type === 'text') {
      const b = fit(layer.box, false);
      const hasPanel = layer.panel && layer.panel !== 'none';
      const pad = hasPanel ? 'padding: 1.6cqmin 2.4cqmin;' : '';
      const panel = hasPanel ? `background: color-mix(in srgb, ${colorVar(layer.panel as ColorRole)} ${Math.round((layer.panelOpacity ?? 1) * 100)}%, transparent);` : '';
      const radius = layer.radius ? `border-radius: ${(layer.radius / 100) * Math.min(b.w, b.h) * 2}cqmin;` : '';
      const align = layer.align === 'center' ? 'center' : layer.align === 'right' ? 'flex-end' : 'flex-start';
      const tone = layer.color === 'auto' ? '' : `color: ${colorVar(layer.color)};`;
      const font = `font-family: var(--f-${layer.font || 'text'});`;
      const weight = layer.weight === 'black' ? 'font-weight: 900;' : layer.weight === 'bold' ? 'font-weight: 700;' : 'font-weight: 400;';
      css.push(`.${c} { ${boxCss(b)} align-items: ${align}; text-align: ${layer.align}; ${pad} ${panel} ${radius} ${tone} ${font} ${weight} ${layer.upper ? 'text-transform: uppercase; letter-spacing: 0.04em;' : ''} }`);
      const toneAttr = layer.color === 'auto' ? ` data-tone="auto" data-key="${layer.role}"` : '';
      // A person breaking out of a frame may stand in front of the headline a little, by design.
      const personOk = layer.role === 'headline' && breakoutsLater(scene, layer) ? ' data-person-ok="0.25"' : '';
      const tr = TEXT_ROLE[layer.role];
      if (tr) {
        parts.push(`<div class="sc-r ${c}" data-fit-box${personOk}><${tr.tag} data-field="${tr.field}" data-fit data-min="${tr.min}" data-max="${tr.max}" data-lines="${layer.lines || 2}" data-fit-order="${tr.order}"${toneAttr} style="line-height:${layer.role === 'headline' ? 1.02 : 1.25}"></${tr.tag}></div>`);
      } else if (layer.role === 'details') {
        parts.push(`<div class="sc-r ${c}"${toneAttr} data-details><template><div class="d-detail sc-detail"><span data-detail-icon></span><span data-detail-text></span></div></template></div>`);
        // As large as reads well: one line per detail, or two when the box is tall enough and that
        // makes the words bigger. Sizes in cqw (the poster's width), from the box's height and width.
        const n = Math.max(1, details);
        const longest = Math.max(8, ...(scene.copy.details || []).map((d) => d.text.length));
        const per = b.h / n / pa; // each detail's share of the height, in cqw
        const one = Math.min(per * 0.5, (b.w * 0.94) / (longest * 0.56 + 1.6));
        const two = Math.min(per / 2.7, (b.w * 0.94) / (longest * 0.3 + 1.6));
        const size = Math.max(one, two);
        css.push(`.${c} { gap: ${(per * 0.18).toFixed(2)}cqw; } .${c} .sc-detail { display: flex; align-items: flex-start; gap: 0.5em; font-family: var(--f-display); font-weight: 700; font-size: clamp(2.1cqmin, ${size.toFixed(2)}cqw, 4.8cqmin); line-height: 1.18; justify-content: ${align}; } .${c} .sc-detail svg { margin-top: 0.1em; }`);
        css.push(`.${c} .sc-detail svg { width: 1em; height: 1em; flex: none; }`);
      } else if (layer.role === 'badge') {
        parts.push(`<div class="sc-r ${c}" data-badge style="align-items:center;text-align:center"><span data-badge-top></span><span data-badge-main style="font-size:2.2em;line-height:1;font-weight:900"></span><span data-badge-bottom></span></div>`);
        css.push(`.${c} { font-family: var(--f-display); font-weight: 700; font-size: ${Math.max(2.4, Math.min(5, b.h * 0.18))}cqmin; text-transform: uppercase; }`);
      } else if (layer.role === 'contact') {
        parts.push(`<div class="sc-r ${c}"${toneAttr} style="flex-direction:row;gap:3cqmin;justify-content:${align};font-size:1.9cqmin"><p data-if="social"><span data-icon="at"></span> <span data-field="social"></span></p><p data-if="web"><span data-icon="web"></span> <span data-field="web"></span></p></div>`);
      }
    } else if (layer.type === 'logo') {
      const b = fit(layer.box, false);
      const align = layer.align === 'center' ? 'center' : layer.align === 'right' ? 'flex-end' : 'flex-start';
      parts.push(`<div class="sc-r ${c}" style="flex-direction:row;gap:2cqmin;justify-content:${align}"><div class="sc-logo" data-logo="primary"></div><div class="sc-logo" data-logo="campaign"></div></div>`);
      css.push(`.${c} { ${boxCss(b)} }`);
      css.push(`.${c} .sc-logo { height: 100%; flex: 0 1 auto; min-width: 0; max-width: 100%; display: flex; align-items: center; } .${c} .sc-logo + .sc-logo { max-width: 45%; } .${c} .sc-logo img { height: 100%; width: auto; max-width: 100%; object-fit: contain; }`);
    } else if (layer.type === 'partners') {
      const b = fit(layer.box, false);
      const align = layer.align === 'center' ? 'center' : layer.align === 'right' ? 'flex-end' : 'flex-start';
      const panel = layer.panel && layer.panel !== 'none' ? `background: ${colorVar(layer.panel)}; padding: 1cqmin 2cqmin;` : '';
      const radius = layer.radius ? `border-radius: ${(layer.radius / 100) * Math.min(b.w, b.h) * 2}cqmin;` : '';
      parts.push(`<div class="sc-r ${c}" data-sponsors data-rows="1"><p class="sc-sp-title" data-field="sponsorsTitle"></p><div class="d-sponsor-row sc-sp-row" data-sponsor-row></div></div>`);
      css.push(`.${c} { ${boxCss(b)} gap: 0.8cqmin; ${panel} ${radius} } .${c} .sc-sp-title { font-family: var(--f-display); font-size: 1.7cqmin; letter-spacing: 0.08em; text-transform: uppercase; } .${c} .sc-sp-row { flex: 1; width: 100%; min-height: 0; max-height: ${(logoH * 0.7).toFixed(2)}cqh; justify-content: ${align}; }`);
    }
  }
  // Breakouts: the photo's people cut out, exactly over the photo, after the back layers (photos,
  // shapes) and before words and logos; clipped to the frame's sides and bottom ("top": they rise
  // above it) or not at all ("all").
  if (breakouts.length) {
    const html: string[] = [];
    breakouts.forEach(({ layer, frame, place }, i) => {
      const c = `sc-b${i + 1}`;
      const clip = layer.breakout === 'top' ? `clip-path: inset(0 ${pct(100 - frame.x - frame.w)} ${pct(100 - frame.y - frame.h)} ${pct(frame.x)});` : '';
      html.push(`<div class="sc-l ${c}" style="inset:0;${clip}"><div class="sc-cut" data-cutout="${layer.photo + 1}" data-exact style="position:absolute;${boxCss(cutBox(place, photos[layer.photo]))}"></div></div>`);
      css.push(`.${c} { pointer-events: none; }`);
    });
    const firstFront = parts.findIndex((p) => /class="sc-r /.test(p));
    parts.splice(firstFront < 0 ? parts.length : firstFront, 0, ...html);
  }

  const fields: DesignTemplate['fields'] = [];
  for (const l of scene.layers) {
    if (l.type !== 'text') continue;
    const tr = TEXT_ROLE[l.role];
    if (tr) fields.push({ name: tr.field, required: tr.field === 'headline', max: tr.field === 'headline' ? 90 : tr.field === 'subhead' ? 200 : 60 });
    if (l.role === 'details') fields.push({ name: 'details' });
    if (l.role === 'badge') fields.push({ name: 'badge' });
    if (l.role === 'contact') fields.push({ name: 'social', max: 40 }, { name: 'web', max: 40 });
  }
  if (scene.layers.some((l) => l.type === 'partners')) fields.push({ name: 'sponsorsTitle', max: 40 });
  const maxPhoto = Math.max(0, ...scene.layers.filter((l): l is PhotoLayer => l.type === 'photo').map((l) => l.photo + 1));
  const tall = format === 'portrait' || format === 'story' || format === 'a4' || format === 'a3';
  return {
    id,
    version: 2,
    name: 'Scene',
    description: 'A layered poster read from a concept.',
    tags: ['scene'],
    formats: tall ? [format, 'a4', 'a3'] : [format],
    fields,
    photos: { min: 0, max: maxPhoto },
    sponsors: { min: 0, max: scene.layers.some((l) => l.type === 'partners') ? 12 : 0 },
    background: scene.backdrop.kind === 'art' ? 'required' : 'none',
    params: [],
    html: parts.join('\n'),
    css: css.join('\n'),
    source: 'imported'
  };
}

function breakoutsLater(scene: Scene, _l: SceneLayer): boolean {
  return scene.layers.some((x) => x.type === 'photo' && !!x.breakout);
}

/** Where the trimmed cut-out sits on the poster: its box inside the photo, mapped onto the photo's place. */
function cutBox(place: Box, p?: PhotoInfo): Box {
  const b = p?.cutout?.box || { x: 0, y: 0, w: 1, h: 1 };
  return { x: place.x + b.x * place.w, y: place.y + b.y * place.h, w: b.w * place.w, h: b.h * place.h };
}

// -------------------------------------------------------------------------- people and gutters

/**
 * Nobody is cut by a hard edge: where the people in a photo (their box in the photo, from SAM 3)
 * cross a frame's edge inside the poster, the photo is moved, then shown wider, to keep them in;
 * if they still don't fit, that edge fades softly instead. Returns what it did, for the record.
 */
export function keepPeopleInFrame(layer: PhotoLayer, people: Box01, canvasAspect: number, photo: { width: number; height: number }): string[] {
  const done: string[] = [];
  const pa = photo.width / photo.height;
  const f = layer.frame;
  const inside = { left: f.x > 0.5, right: f.x + f.w < 99.5, top: f.y > 0.5, bottom: f.y + f.h < 99.5 };
  const soft = new Set(fadeSides(layer.fade));
  if (soft.has('edges') || !layer.place) return done;
  const span = (p: Box) => ({ x0: p.x + people.x * p.w, x1: p.x + (people.x + people.w) * p.w, y0: p.y + people.y * p.h, y1: p.y + (people.y + people.h) * p.h });
  // Small overhangs (a hand, an elbow) are fine: 4% of the people's own size.
  const cuts = (p: Box) => {
    const b = span(p);
    const tx = (b.x1 - b.x0) * 0.04;
    const ty = (b.y1 - b.y0) * 0.04;
    return {
      left: inside.left && !soft.has('left') && b.x0 < f.x - tx,
      right: inside.right && !soft.has('right') && b.x1 > f.x + f.w + tx,
      top: inside.top && !soft.has('top') && b.y0 < f.y - ty,
      bottom: inside.bottom && !soft.has('bottom') && b.y1 > f.y + f.h + ty
    };
  };
  const c0 = cuts(layer.place);
  if (!c0.left && !c0.right && !c0.top && !c0.bottom) return done;
  // Wider view first when the people are bigger than the frame (the least zoom that covers it).
  let place = layer.place;
  // People may run off the poster's own edge by up to 12% of their size (a shoulder, not half a group).
  const fits = (p: Box) => {
    const b = span(p);
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const roomX = f.w * 1.04 + (inside.left ? 0 : w * 0.12) + (inside.right ? 0 : w * 0.12);
    const roomY = f.h * 1.04 + (inside.top ? 0 : h * 0.12) + (inside.bottom ? 0 : h * 0.12);
    return { x: w <= roomX, y: h <= roomY };
  };
  if (!fits(place).x || !fits(place).y) {
    const least = placeFromCrop(f, canvasAspect, photo);
    if (least.w < place.w - 0.5) {
      place = { ...least };
      done.push('shown wider');
    }
  }
  // Each direction: people that fit are moved in; people that don't stay centred on the frame.
  const b = span(place);
  const ok = fits(place);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  let dx = 0;
  let dy = 0;
  if (ok.x) {
    if (b.x1 > f.x + f.w && inside.right) dx = f.x + f.w - b.x1;
    if (b.x0 + dx < f.x && inside.left) dx = f.x - b.x0;
  } else dx = f.x + f.w / 2 - cx;
  if (ok.y) {
    if (b.y1 > f.y + f.h && inside.bottom) dy = f.y + f.h - b.y1;
    if (b.y0 + dy < f.y && inside.top) dy = f.y - b.y0;
  } else dy = f.y + f.h * 0.45 - cy;
  place = { ...place, x: Math.max(f.x + f.w - place.w, Math.min(f.x, place.x + dx)), y: Math.max(f.y + f.h - place.h, Math.min(f.y, place.y + dy)) };
  if (place.x !== layer.place.x || place.y !== layer.place.y || place.w !== layer.place.w) {
    layer.place = place;
    layer.crop = undefined;
    if (!done.length) done.push('moved');
  }
  // Still cut: soften those edges.
  const c = cuts(layer.place);
  const sides = (['left', 'right', 'top', 'bottom'] as const).filter((k) => c[k]);
  if (sides.length) {
    const all = Array.from(new Set([...fadeSides(layer.fade), ...sides]));
    layer.fade = { side: all[0], size: Math.max(layer.fade?.size || 0, 22), also: all.length > 1 ? all.slice(1) : undefined };
    done.push(`faded ${sides.join(' and ')}`);
  }
  return done;
}

/** A box in shares of a photo (0–1). */
export type Box01 = { x: number; y: number; w: number; h: number };

/**
 * Room between words and a photo's hard edge: words, logos and partners that start (or end) within
 * 3% of a hard frame edge inside the poster move off it, giving up width (never below 15%).
 */
export function keepGutters(scene: Scene): void {
  const G = 3;
  for (const l of scene.layers) {
    if (l.type !== 'text' && l.type !== 'logo' && l.type !== 'partners') continue;
    if (l.type === 'text' && l.panel && l.panel !== 'none') continue;
    for (const p of scene.layers) {
      if (p.type !== 'photo') continue;
      const f = p.frame;
      const soft = new Set(fadeSides(p.fade));
      if (soft.has('edges') || p.shape === 'circle' || p.shape === 'blob' || p.shape === 'organic') continue;
      const vertical = l.box.y < f.y + f.h && f.y < l.box.y + l.box.h;
      if (!vertical) continue;
      const R = f.x + f.w;
      if (R < 99.5 && !soft.has('right') && l.box.x > R - 8 && l.box.x < R + G) {
        const nx = R + G;
        const nw = l.box.w - (nx - l.box.x);
        if (nw >= 15) l.box = { ...l.box, x: nx, w: nw };
      }
      const L = f.x;
      const right = l.box.x + l.box.w;
      if (L > 0.5 && !soft.has('left') && right < L + 8 && right > L - G) {
        const nw = L - G - l.box.x;
        if (nw >= 15) l.box = { ...l.box, w: nw };
      }
    }
  }
}

// ------------------------------------------------------------------------------------ new shapes

/**
 * The scene on a canvas of another shape. With `boxes` (from a quick model's new layout), every
 * layer moves there; without, positions keep their percentages (a portrait layout stretched to a
 * landscape keeps its order). Either way each photo keeps showing the part it showed.
 */
export function reshapeScene(scene: Scene, aspect: number, photos: PhotoInfo[], boxes?: Map<string, Box>): Scene {
  const next: Scene = JSON.parse(JSON.stringify(scene));
  for (const l of next.layers) {
    const b = boxes?.get(l.id);
    if (l.type === 'photo') {
      const p = photos[l.photo];
      const old = l.place || (p ? placeFromCrop(l.frame, scene.aspect, p, l.crop) : null);
      // The part of the photo the frame showed (shares of the photo).
      const crop = old ? { x: Math.max(0, (l.frame.x - old.x) / old.w), y: Math.max(0, (l.frame.y - old.y) / old.h), w: Math.min(1, l.frame.w / old.w) } : l.crop;
      if (b) l.frame = { x: b.x, y: b.y, w: Math.max(2, b.w), h: Math.max(2, b.h) };
      l.crop = crop;
      l.place = p ? placeFromCrop(l.frame, aspect, p, crop) : undefined;
      l.mask = l.shape === 'organic' ? l.mask : undefined;
    } else if (b) l.box = { x: b.x, y: b.y, w: Math.max(2, b.w), h: Math.max(2, b.h) };
  }
  next.aspect = aspect;
  return next;
}

// --------------------------------------------------------------------------------------- the doc

export type SceneDoc = DesignDoc & { scene: Scene; conceptUrl?: string };

export function sceneDoc(o: {
  id: string;
  format: FormatId;
  scene: Scene;
  art?: { url: string; width: number; height: number } | null;
  photos: PhotoSlot[];
  sponsors: DesignDoc['sponsors'];
  primaryLogo: string;
  campaignLogos: string[];
  conceptUrl?: string;
}): SceneDoc {
  const used = new Set(o.scene.layers.filter((l): l is PhotoLayer => l.type === 'photo').map((l) => l.photo));
  const last = used.size ? Math.max(...used) : -1;
  return {
    version: 1,
    designId: o.id,
    designVersion: 2,
    format: o.format,
    params: {},
    text: o.scene.copy,
    // Photo numbers in the scene are positions in this list.
    photos: o.photos.slice(0, last + 1),
    logos: { primary: o.primaryLogo, campaign: o.campaignLogos },
    sponsors: o.scene.layers.some((l) => l.type === 'partners') ? o.sponsors : [],
    background: o.scene.backdrop.kind === 'art' && o.art ? { url: o.art.url, width: o.art.width, height: o.art.height, prompt: 'scene backdrop' } : null,
    scene: o.scene,
    conceptUrl: o.conceptUrl
  };
}

/** The template a stored scene doc draws with (edits, prints, sizes). */
export function templateForDoc(doc: DesignDoc, format?: FormatId): DesignTemplate | null {
  const scene = (doc as SceneDoc).scene;
  if (!scene || scene.version !== 2) return null;
  return sceneTemplate(scene, doc.designId, format || doc.format, doc.photos);
}

// --------------------------------------------------------------------------------------- repairs

const meets = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Whether a box would run into another word or logo layer. */
function overlapsFront(scene: Scene, self: SceneLayer, box: Box): boolean {
  return scene.layers.some((l) => l !== self && (l.type === 'text' || l.type === 'logo' || l.type === 'partners') && meets(l.box, box));
}

const textLayerFor = (scene: Scene, key?: string): TextLayer | undefined => {
  if (!key) return undefined;
  const role = key.startsWith('detail') ? 'details' : (Object.keys(TEXT_ROLE) as TextRole[]).find((r) => TEXT_ROLE[r]!.field === key || key.startsWith(TEXT_ROLE[r]!.field)) || key;
  return scene.layers.find((l): l is TextLayer => l.type === 'text' && l.role === role);
};

/**
 * Fixes a scene from what the checks found, the way a designer would: words that don't read get
 * "auto" colour, then a panel; partners that outweigh the logo get a smaller strip; words that
 * overflow get a taller box; a photo enlarged too much is shown less zoomed. Null if nothing to fix.
 */
export function repairScene(scene: Scene, issues: { level: string; code: string; key?: string }[], photos: PhotoInfo[] = []): Scene | null {
  const next: Scene = JSON.parse(JSON.stringify(scene));
  let changed = false;
  for (const i of issues) {
    if (i.code === 'contrast') {
      const t = textLayerFor(next, i.key) || next.layers.find((l): l is TextLayer => l.type === 'text' && l.role === 'headline');
      if (!t) continue;
      if (t.color !== 'auto' && (!t.panel || t.panel === 'none')) t.color = 'auto';
      else if (!t.panel || t.panel === 'none') {
        t.panel = 'ink';
        t.panelOpacity = 0.8;
        t.color = 'paper';
        t.radius = t.radius || 4;
      } else t.panelOpacity = 1;
      changed = true;
    } else if (i.code === 'sponsor-dominant') {
      const p = next.layers.find((l) => l.type === 'partners');
      const g = next.layers.find((l) => l.type === 'logo');
      if (p) p.box.h = Math.max(6, p.box.h * 0.72);
      if (g && g.box.h < 7) g.box.h = 7;
      changed = true;
    } else if (i.level === 'error' && (i.code === 'text-overflow' || i.code === 'text-small')) {
      const t = textLayerFor(next, i.key);
      if (!t) continue;
      // Wider first, where nothing else sits; then taller.
      const wider = { ...t.box, w: Math.min(100 - t.box.x - 5, t.box.w * 1.3) };
      if (wider.w > t.box.w + 0.5 && !overlapsFront(next, t, wider)) t.box = wider;
      t.box.h = Math.min(97 - t.box.y, t.box.h * 1.25);
      t.lines = Math.min(8, (t.lines || 2) + 1);
      changed = true;
    } else if (i.level === 'error' && (i.code === 'text-overlap' || (i.code === 'text-covered' && !!textLayerFor(next, i.key)))) {
      // Words running into other words: this box gives way (it stops above the one below, or
      // starts under the one above); the words then fit the smaller box.
      const t = textLayerFor(next, i.key);
      if (!t) continue;
      for (const o of next.layers) {
        if (o === t || (o.type !== 'text' && o.type !== 'logo' && o.type !== 'partners') || !meets(o.box, t.box)) continue;
        if (o.box.y >= t.box.y) t.box.h = Math.max(3, o.box.y - 1 - t.box.y);
        else {
          const ny = o.box.y + o.box.h + 1;
          t.box.h = Math.max(3, t.box.h - (ny - t.box.y));
          t.box.y = ny;
        }
        changed = true;
      }
    } else if (i.code === 'clear-space') {
      // Words inside the logo's clear space move away from it.
      const g = next.layers.find((l): l is LogoLayer => l.type === 'logo');
      if (!g) continue;
      const m = g.box.h * 0.35;
      const zone = { x: g.box.x - m, y: g.box.y - m, w: g.box.w + 2 * m, h: g.box.h + 2 * m };
      for (const t of next.layers) {
        if (t.type !== 'text' || !meets(zone, t.box)) continue;
        if (t.box.y >= g.box.y) {
          const ny = zone.y + zone.h;
          t.box.h = Math.max(3, t.box.h - (ny - t.box.y));
          t.box.y = ny;
        } else t.box.h = Math.max(3, zone.y - t.box.y);
        changed = true;
      }
    } else if (i.code === 'logo-small') {
      const g = next.layers.find((l): l is LogoLayer => l.type === 'logo');
      if (!g) continue;
      const bigger = { ...g.box, h: Math.min(16, Math.max(g.box.h * 1.3, 8)), w: Math.min(100 - g.box.x - 4, Math.max(g.box.w * 1.45, 30)) };
      if (g.align === 'right') bigger.x = Math.max(4, g.box.x + g.box.w - bigger.w);
      if (g.box.y + g.box.h > 60) bigger.y = Math.max(3, g.box.y + g.box.h - bigger.h);
      g.box = bigger;
      changed = true;
    } else if (i.code === 'text-over-subject' || (i.code === 'text-over-person' && i.level === 'error')) {
      // Words over a face: a panel under them won't help; move them off the photo's subject by
      // giving the photo a fade on that side and the words a panel.
      const t = textLayerFor(next, i.key);
      if (!t) continue;
      if (!t.panel || t.panel === 'none') {
        t.panel = 'ink';
        t.panelOpacity = 0.85;
        t.color = 'paper';
        t.radius = t.radius || 3;
        changed = true;
      }
    } else if (i.code === 'photo-small') {
      for (const l of next.layers) {
        if (l.type !== 'photo' || !photos[l.photo]) continue;
        const p = photos[l.photo];
        const least = placeFromCrop(l.frame, next.aspect, p);
        if (!l.place || l.place.w > least.w * 1.02) {
          l.place = { ...least, x: l.place ? Math.max(l.frame.x + l.frame.w - least.w, Math.min(l.frame.x, l.place.x + (l.place.w - least.w) / 2)) : least.x, y: l.place ? Math.max(l.frame.y + l.frame.h - least.h, Math.min(l.frame.y, l.place.y + (l.place.h - least.h) / 2)) : least.y };
          l.crop = undefined;
          changed = true;
        }
      }
    }
  }
  return changed ? next : null;
}

// ------------------------------------------------------------------------------- without the AI

/**
 * A poster without a concept (no image model, or every concept failed): a clean scene in the
 * brand's colours from code, its words stacked so nothing collides. With a photo: the photo across
 * the top (variant 1: full-bleed, fading into the colour), the words on a colour band below; without:
 * a typographic poster on a colour ground with one bold shape away from the words.
 */
export function fallbackScene(o: { copy: DesignText; photos: PhotoSlot[]; partners: number; aspect: number; variant?: number }): Scene {
  const v = (o.variant || 0) % 2;
  const photo = o.photos.length > 0;
  const layers: SceneLayer[] = [];
  const end = o.partners ? 84 : 95; // the bottom row (button, logo) ends here
  const rowH = 7;
  const nDetails = o.copy.details?.length || 0;
  if (photo) {
    const ph = v ? 64 : 52;
    if (!v) layers.push({ type: 'shape', id: 's1', box: { x: 0, y: ph - 1, w: 100, h: 102 - ph }, color: 'primary', opacity: 1, shape: 'rect' });
    layers.push({ type: 'photo', id: 'p1', photo: 0, frame: { x: 0, y: 0, w: 100, h: ph }, shape: 'rect', fade: v ? { side: 'bottom', size: 30 } : undefined });
  } else {
    layers.push(v ? { type: 'shape', id: 's1', box: { x: 64, y: -14, w: 58, h: 40 }, color: 'accent', opacity: 0.95, shape: 'circle' } : { type: 'shape', id: 's1', box: { x: 7, y: 19, w: 14, h: 1.2 }, color: 'accent', opacity: 1, shape: 'rect' });
  }
  // The words, top to bottom, sized to the room left above the bottom row.
  const top = photo ? (v ? 52 : 56) : 24;
  const room = end - rowH - 2 - top;
  const want = {
    eyebrow: !photo && o.copy.eyebrow ? 4 : 0,
    headline: photo ? 15 : 26,
    subhead: !photo && o.copy.subhead ? 9 : 0,
    details: nDetails ? nDetails * 4.4 : 0
  };
  const total = want.eyebrow + want.headline + want.subhead + want.details + 1.5 * [want.eyebrow, want.subhead, want.details].filter(Boolean).length;
  const k = total > room ? room / total : 1;
  let y = top;
  const ink: ColorRole | 'auto' = 'auto';
  const put = (role: TextRole, h: number, extra: Partial<TextLayer> = {}, w = 86) => {
    if (!h) return;
    layers.push({ type: 'text', id: role, role, box: { x: 7, y, w, h: h * k }, align: 'left', color: ink, panel: 'none', weight: role === 'headline' ? 'black' : 'bold', font: 'display', lines: role === 'headline' ? 3 : 2, ...extra });
    y += h * k + 1.5 * k;
  };
  put('eyebrow', want.eyebrow, { color: 'auto', upper: true, lines: 1 });
  put('headline', want.headline);
  put('subhead', want.subhead, { weight: 'regular', font: 'text', lines: 3 });
  put('details', want.details, {}, 80);
  const row = end - rowH;
  if (o.copy.cta) layers.push({ type: 'text', id: 'cta', role: 'cta', box: { x: 7, y: row + 0.5, w: 40, h: rowH - 1 }, align: 'center', color: 'ink', panel: 'accent', radius: 50, weight: 'bold', font: 'display', lines: 1 });
  layers.push({ type: 'logo', id: 'logo', box: { x: o.copy.cta ? 55 : 7, y: row, w: o.copy.cta ? 38 : 40, h: rowH }, align: o.copy.cta ? 'right' : 'left' });
  if (o.partners) layers.push({ type: 'partners', id: 'partners', box: { x: 5, y: 87, w: 90, h: 10 }, align: 'center', panel: 'paper', radius: 6 });
  return { version: 2, aspect: o.aspect, backdrop: { kind: 'color', color: 'primary' }, layers, copy: o.copy };
}

export function brandColors(kit: BrandKit): Record<ColorRole, string> {
  return { primary: kit.colors.primary.hex, secondary: kit.colors.secondary.hex, accent: kit.colors.accent.hex, ink: kit.colors.ink.hex, paper: kit.colors.paper.hex };
}
