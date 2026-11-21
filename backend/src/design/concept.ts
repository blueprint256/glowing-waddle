import type { BrandKit, DesignDoc, DesignTemplate, DesignText, FormatId, TextField } from './types';

/**
 * Concept-first posters.
 *
 * 1. Concept: the image model draws a complete poster from words alone: the brief, the brand's
 *    colours and mood, how much text there is, and the spaces to leave (a main logo, a strip of N
 *    partner logos, a wide photo of people). It's never given our files: it composes far better
 *    from a description than when asked to fit real logos and photos in. Nobody sees this picture.
 * 2. Art layer: the same picture with every word, number, logo and badge removed (an image edit).
 * 3. Reading: Claude looks at the concept and writes a blueprint: where the headline, details,
 *    logo, partner strip and photo sit, how they're aligned and coloured (in the brand's colours),
 *    which of the concept's imagery stays (atmosphere, scenery) and where the real photo goes, plus
 *    the real words, from the brief.
 * 4. Build: the blueprint becomes a design the engine renders like any other: real words in the
 *    brand fonts, the real logo files and partners, the real photo, on the art layer, then every
 *    check (contrast, clear space, overflow, partner balance) runs. Improving on the concept is
 *    the point: alignment, hierarchy, contrast and logo rules are the engine's, not the sketch's.
 */

export type RegionRole = 'eyebrow' | 'headline' | 'subhead' | 'details' | 'cta' | 'badge' | 'logo' | 'partners' | 'photo' | 'contact';
export type ColorRole = 'primary' | 'secondary' | 'accent' | 'ink' | 'paper';

export interface ConceptRegion {
  role: RegionRole;
  /** Percent of the poster's width and height (0–100). */
  x: number;
  y: number;
  w: number;
  h: number;
  align?: 'left' | 'center' | 'right';
  /** Text colour: a brand colour, or "auto" (light or dark, whichever reads on what's behind). */
  color?: ColorRole | 'auto';
  /** A solid shape behind this element (a band, a pill, a card), in a brand colour. */
  panel?: ColorRole | 'none';
  panelOpacity?: number;
  /** Corner rounding of the panel or photo, percent of its shorter side (50 = pill/circle). */
  radius?: number;
  upper?: boolean;
  weight?: 'regular' | 'bold' | 'black';
  font?: 'display' | 'text' | 'accent';
  /** Most lines the words may take. */
  lines?: number;
}

export interface ConceptBlueprint {
  regions: ConceptRegion[];
  /** Where the real photo goes ("photo" region); "keep" leaves the concept's imagery there. */
  photoUse?: 'real' | 'keep';
  /** A soft fade behind the words, if the art needs one for contrast. */
  scrim?: { from: 'top' | 'bottom' | 'left' | 'right'; color: ColorRole; strength: number } | null;
  /** The real words. */
  copy: DesignText;
  /** What of the concept's imagery is kept (for the record and the review). */
  keep?: string;
  /** How the poster improves on the concept (alignment, hierarchy…), for the record. */
  improvements?: string;
}

/** Image sizes the concept and art layer are made at, by poster shape. */
export const CONCEPT_SIZE: Record<string, string> = {
  portrait: '1024x1536',
  story: '1024x1536',
  a4: '1024x1536',
  a3: '1024x1536',
  square: '1024x1024',
  landscape: '1536x1024'
};

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
  /** How much text there will be. */
  words: { headline: boolean; details: number; cta: boolean; subhead: boolean };
  partners: number;
  otherLogos: number;
  /** The real photos, described by shape and content (never sent as files). */
  photos: { shape: 'wide' | 'tall' | 'square'; description?: string }[];
  /** A different direction per option, so they don't come out alike. */
  direction: string;
}

/** Directions given to the concepts of one poster, one each, so the options differ. */
export const CONCEPT_DIRECTIONS = [
  'Bold and graphic: big confident type, strong colour blocks, a clear focal image.',
  'Photographic and warm: a large natural-light scene that carries the mood, type set calmly over a quiet part of it.',
  'Editorial and elegant: generous space, refined layout, a striking crop, understated colour.',
  'Lively and celebratory: energetic composition, shapes and texture, a sense of occasion.'
];

/** The words the image model gets: what the poster is for, and the spaces to leave. Never files. */
export function conceptPrompt(a: ConceptAsk): string {
  const brief = a.brief.replace(/\n+\s*(Poster facts|Picture):[\s\S]*$/i, '').trim() || a.brief.trim();
  const spaces: string[] = [];
  spaces.push(`the main logo of ${a.brandName || 'the organisation'} (a plain placeholder box, top or bottom)`);
  if (a.otherLogos) spaces.push(`${a.otherLogos} more small logo placeholder${a.otherLogos > 1 ? 's' : ''} beside it`);
  if (a.partners) spaces.push(`a tidy strip of ${a.partners} partner logo placeholders (plain light rounded boxes, equal size) along one edge`);
  a.photos.forEach((p, i) =>
    spaces.push(`a ${p.shape} photo area${p.description ? ` showing ${p.description}` : ''}${a.photos.length > 1 ? ` (photo ${i + 1})` : ''}`)
  );
  const text = [
    a.words.headline ? 'a short, large headline (placeholder words are fine)' : '',
    a.words.subhead ? 'one short supporting line' : '',
    a.words.details ? `${a.words.details} short detail line${a.words.details > 1 ? 's' : ''} (date, time, place)` : '',
    a.words.cta ? 'a call-to-action button' : ''
  ].filter(Boolean);
  return [
    `Design ${SHAPE_WORDS[a.format] || 'a social media poster'} for ${a.brandName || 'an organisation'}${a.sector ? ` (${a.sector})` : ''}.`,
    `What it's about: ${brief.slice(0, 900)}`,
    `Colours: use the brand palette: ${(['primary', 'secondary', 'accent'] as ColorRole[]).map((r) => a.colors[r]).join(', ')}, with ${a.colors.paper} and ${a.colors.ink} for light and dark.${a.mood ? ` Mood: ${a.mood}.` : ''}`,
    `Direction: ${a.direction}`,
    `Text it will carry: ${text.join(', ')}.`,
    `Leave room for: ${spaces.join('; ')}.`,
    'Make it a finished, professional poster: strong composition, clear hierarchy, generous margins, imagery that blends naturally with the colour areas. Keep every text and logo area on a calm, simple part of the design so words can be read. No other brands, no watermark, no mock-up frame or border.'
  ].join('\n');
}

/** The art layer: the concept with every word and logo taken out. */
export const ART_LAYER_PROMPT =
  'Remove every word, letter, number, logo, logo placeholder, badge and button from this poster. Fill each of those areas with what would naturally be behind it (the same colour field, texture, sky, gradient or panel), so it looks finished and empty. Keep every other part exactly the same: the imagery, composition, colours, shapes and lighting. No text of any kind.';

export const CONCEPT_READER_SYSTEM = `You are a senior designer turning a poster concept into a precise, brand-perfect poster. You're given the concept picture (made by an image model from a description; its words and logos are placeholders), the brief, the brand and the real content. You write a blueprint the layout engine renders with the real words, logo files, partner logos and photos, on the concept's art with its words removed.

Read the concept's intent and improve on it:
- Keep its composition: where the headline, details, logo, partner strip and photo sit, their alignment, the colour areas the words sit on, the overall mood.
- Improve it: align things to clean edges and a consistent margin (at least 5% from every side), make the hierarchy obvious (headline clearly first), give text enough room, keep it on calm areas, add a panel or a soft fade wherever the art behind words is busy, keep logos away from clutter.
- Brand: colours are only the brand's (primary, secondary, accent, ink, paper). Fonts are the brand's display (headlines), text (body) and accent (a word or two at most).
- Positions are percentages of the poster's width (x, w) and height (y, h). Boxes must not overlap, except text sitting inside a panel or over the art. Give each text box room for its words at a readable size: a headline box is usually 12–30% of the height; details 3–5% per line; partner strip 8–14% high.
- The main logo is always placed ("logo"), at least 6% of the poster's shorter side high, on a calm area. If partners are given, place one "partners" strip wide enough for all of them in one row (they're sized evenly). If there's a real photo, place one "photo" region where the concept's main image is, shaped like the concept's (rounded or circle if it is), and set photoUse "real"; if there's no real photo, set photoUse "keep" and don't add a photo region: the concept's imagery stays in the art.
- Words: write the real copy from the brief only. Use facts exactly as given; never invent dates, places, names, numbers or prices. Headline at most about 8 words. Use the poster facts lines if the brief has them. Only include fields that have something true to say.
- color "auto" picks light or dark text for what's behind it; prefer it for text over imagery. Use a brand colour where the concept clearly uses one.`;

const ROLE_ENUM: RegionRole[] = ['eyebrow', 'headline', 'subhead', 'details', 'cta', 'badge', 'logo', 'partners', 'photo', 'contact'];
const COLOR_ENUM = ['primary', 'secondary', 'accent', 'ink', 'paper'];

export const CONCEPT_TOOL = {
  name: 'write_blueprint',
  description: 'The blueprint of the poster: its regions and the real words.',
  schema: {
    type: 'object',
    required: ['regions', 'copy'],
    properties: {
      regions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['role', 'x', 'y', 'w', 'h'],
          properties: {
            role: { type: 'string', enum: ROLE_ENUM },
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
            align: { type: 'string', enum: ['left', 'center', 'right'] },
            color: { type: 'string', enum: [...COLOR_ENUM, 'auto'] },
            panel: { type: 'string', enum: [...COLOR_ENUM, 'none'] },
            panelOpacity: { type: 'number' },
            radius: { type: 'number' },
            upper: { type: 'boolean' },
            weight: { type: 'string', enum: ['regular', 'bold', 'black'] },
            font: { type: 'string', enum: ['display', 'text', 'accent'] },
            lines: { type: 'integer' }
          }
        }
      },
      photoUse: { type: 'string', enum: ['real', 'keep'] },
      scrim: {
        type: 'object',
        properties: { from: { type: 'string', enum: ['top', 'bottom', 'left', 'right'] }, color: { type: 'string', enum: COLOR_ENUM }, strength: { type: 'number' } }
      },
      copy: {
        type: 'object',
        properties: {
          eyebrow: { type: 'string' },
          headline: { type: 'string' },
          subhead: { type: 'string' },
          details: { type: 'array', items: { type: 'object', required: ['kind', 'text'], properties: { kind: { type: 'string', enum: ['date', 'time', 'place', 'phone', 'web', 'price', 'note'] }, text: { type: 'string' } } } },
          cta: { type: 'string' },
          badge: { type: 'object', properties: { top: { type: 'string' }, main: { type: 'string' }, bottom: { type: 'string' } } },
          sponsorsTitle: { type: 'string' }
        }
      },
      keep: { type: 'string' },
      improvements: { type: 'string' }
    }
  }
};

export function conceptReaderPrompt(o: { brief: string; facts?: string; brand: string; partners: string[]; otherLogos: number; photos: number; format: FormatId }): string {
  return [
    `Poster shape: ${o.format}.`,
    `Brief:\n${o.brief.slice(0, 2500)}`,
    o.brand,
    `Real content: the main logo${o.otherLogos ? ` and ${o.otherLogos} other logo${o.otherLogos > 1 ? 's' : ''}` : ''}; ${o.partners.length ? `${o.partners.length} partner logos (${o.partners.join(', ')})` : 'no partners'}; ${o.photos ? `${o.photos} real photo${o.photos > 1 ? 's' : ''} (shown after the concept)` : 'no real photo'}.`,
    'The first picture is the concept. Write the blueprint.'
  ].join('\n\n');
}

// ----------------------------------------------------------------------------------------- build

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && isFinite(v) ? v : d;
  return Math.max(lo, Math.min(hi, n));
};
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Cleans what the reader wrote: boxes inside the poster, known roles, one logo/partners/photo. */
export function cleanBlueprint(raw: any, opts: { partners: number; photos: number }): ConceptBlueprint {
  const seen = new Set<RegionRole>();
  const regions: ConceptRegion[] = [];
  for (const r of Array.isArray(raw?.regions) ? raw.regions : []) {
    const role = pick(r?.role, ROLE_ENUM, 'headline');
    if (!ROLE_ENUM.includes(r?.role)) continue;
    if (seen.has(role)) continue;
    if (role === 'partners' && !opts.partners) continue;
    if (role === 'photo' && (!opts.photos || raw?.photoUse === 'keep')) continue;
    seen.add(role);
    const x = num(r.x, 0, 95, 6);
    const y = num(r.y, 0, 95, 6);
    regions.push({
      role,
      x,
      y,
      w: num(r.w, 4, 100 - x, 40),
      h: num(r.h, 2, 100 - y, 10),
      align: pick(r.align, ['left', 'center', 'right'] as const, 'left'),
      color: pick(r.color, [...COLOR_ENUM, 'auto'] as const, 'auto') as ColorRole | 'auto',
      panel: pick(r.panel, [...COLOR_ENUM, 'none'] as const, 'none') as ColorRole | 'none',
      panelOpacity: num(r.panelOpacity, 0, 1, 1),
      radius: num(r.radius, 0, 50, 0),
      upper: Boolean(r.upper),
      weight: pick(r.weight, ['regular', 'bold', 'black'] as const, role === 'headline' ? 'black' : 'regular'),
      font: pick(r.font, ['display', 'text', 'accent'] as const, ['headline', 'eyebrow', 'cta', 'badge'].includes(role) ? 'display' : 'text'),
      lines: Math.round(num(r.lines, 1, 8, role === 'headline' ? 3 : role === 'subhead' ? 3 : 2))
    });
  }
  // The main logo is never left out.
  if (!seen.has('logo')) regions.push({ role: 'logo', x: 6, y: 4, w: 30, h: 8, align: 'left', panel: 'none', color: 'auto' });
  if (opts.partners && !seen.has('partners')) regions.push({ role: 'partners', x: 6, y: 86, w: 88, h: 10, align: 'center', panel: 'paper', panelOpacity: 1, radius: 8, color: 'auto' });
  const copy: DesignText = { headline: '' } as DesignText;
  const c = raw?.copy || {};
  const t = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  copy.headline = t(c.headline, 90) || 'Join us';
  if (t(c.eyebrow, 50)) copy.eyebrow = t(c.eyebrow, 50);
  if (t(c.subhead, 200)) copy.subhead = t(c.subhead, 200);
  if (t(c.cta, 50)) copy.cta = t(c.cta, 50);
  if (t(c.sponsorsTitle, 40)) copy.sponsorsTitle = t(c.sponsorsTitle, 40);
  if (Array.isArray(c.details)) {
    const details = c.details
      .filter((d: any) => d && typeof d.text === 'string' && d.text.trim())
      .slice(0, 4)
      .map((d: any) => ({ kind: pick(d.kind, ['date', 'time', 'place', 'phone', 'web', 'price', 'note'] as const, 'note'), text: d.text.trim().slice(0, 90) }));
    if (details.length) copy.details = details as any;
  }
  if (c.badge && typeof c.badge === 'object' && t(c.badge.main, 12)) copy.badge = { top: t(c.badge.top, 12), main: t(c.badge.main, 12)!, bottom: t(c.badge.bottom, 12) } as any;
  // A region with no words to show goes.
  const has: Record<string, boolean> = {
    eyebrow: !!copy.eyebrow,
    subhead: !!copy.subhead,
    details: !!copy.details?.length,
    cta: !!copy.cta,
    badge: !!copy.badge,
    contact: true
  };
  const kept = regions.filter((r) => has[r.role] !== false);
  const scrim = raw?.scrim && typeof raw.scrim === 'object' && raw.scrim.from ? { from: pick(raw.scrim.from, ['top', 'bottom', 'left', 'right'] as const, 'bottom'), color: pick(raw.scrim.color, COLOR_ENUM as ColorRole[], 'ink'), strength: num(raw.scrim.strength, 0, 1, 0.5) } : null;
  return {
    regions: kept,
    photoUse: opts.photos && kept.some((r) => r.role === 'photo') ? 'real' : 'keep',
    scrim,
    copy,
    keep: t(raw?.keep, 300),
    improvements: t(raw?.improvements, 400)
  };
}

/**
 * Fixes a blueprint from what the checks found, the way a designer would: text that doesn't read
 * gets "auto" colour, then a panel behind it; partners that outweigh the logo get a smaller strip
 * and the logo more room; words that overflow get a taller box. Null when there's nothing to fix.
 */
export function repairBlueprint(bp: ConceptBlueprint, issues: { level: string; code: string; key?: string }[]): ConceptBlueprint | null {
  const next: ConceptBlueprint = JSON.parse(JSON.stringify(bp));
  let changed = false;
  const regionFor = (key?: string) => {
    if (!key) return undefined;
    const role = (Object.keys(TEXT_ROLE) as RegionRole[]).find((r) => TEXT_ROLE[r]!.field === key || key.startsWith(TEXT_ROLE[r]!.field));
    return next.regions.find((r) => r.role === (role || key) || `cx-${next.regions.indexOf(r)}` === key);
  };
  for (const i of issues) {
    if (i.code === 'contrast' || i.code === 'text-contrast') {
      const r = regionFor(i.key) || next.regions.find((x) => x.role === 'headline');
      if (!r) continue;
      if (r.color && r.color !== 'auto' && (!r.panel || r.panel === 'none')) r.color = 'auto';
      else if (!r.panel || r.panel === 'none') {
        r.panel = 'ink';
        r.panelOpacity = 0.78;
        r.color = 'paper';
        r.radius = r.radius || 4;
      } else r.panelOpacity = 1;
      changed = true;
    } else if (i.code === 'sponsor-dominant') {
      const p = next.regions.find((x) => x.role === 'partners');
      const l = next.regions.find((x) => x.role === 'logo');
      if (p) p.h = Math.max(6, p.h * 0.72);
      // Only a small logo grows (a bigger one would crowd what's around it).
      if (l && l.h < 7) l.h = 7;
      changed = true;
    } else if (i.level === 'error' && (i.code === 'text-overflow' || i.code === 'text-small')) {
      const r = regionFor(i.key);
      if (!r) continue;
      r.h = Math.min(100 - r.y, r.h * 1.25);
      r.lines = Math.min(8, (r.lines || 2) + 1);
      changed = true;
    }
  }
  return changed ? next : null;
}

/** The fields a role shows, and its text sizes (hundredths of the poster's short side). */
const TEXT_ROLE: Partial<Record<RegionRole, { field: TextField; min: number; max: number; order: number; tag: string }>> = {
  headline: { field: 'headline', min: 4.2, max: 16, order: 1, tag: 'h1' },
  subhead: { field: 'subhead', min: 2.2, max: 4.2, order: 2, tag: 'p' },
  eyebrow: { field: 'eyebrow', min: 1.8, max: 3, order: 4, tag: 'p' },
  cta: { field: 'cta', min: 2.1, max: 3.4, order: 3, tag: 'p' }
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const colorVar = (c: ColorRole) => `var(--c-${c})`;

/**
 * The design a blueprint renders as: every region absolutely placed, words fitted to their boxes,
 * the art layer behind. Rebuilt the same way from the stored blueprint for edits and prints.
 */
export function conceptTemplate(bp: ConceptBlueprint, id: string, format: FormatId): DesignTemplate {
  const regions = bp.regions;
  const parts: string[] = ['<div class="cx-art d-fill" data-bg></div>'];
  if (bp.scrim) parts.push('<div class="cx-scrim d-fill"></div>');
  const css: string[] = [
    `#poster { background: var(--c-paper); }`,
    `.cx-art { position: absolute; inset: 0; }`,
    `.cx-r { position: absolute; display: flex; flex-direction: column; justify-content: center; overflow: hidden; box-sizing: border-box; }`,
    `.cx-r > * { margin: 0; }`
  ];
  if (bp.scrim) {
    const dir = { top: 'to bottom', bottom: 'to top', left: 'to right', right: 'to left' }[bp.scrim.from];
    css.push(`.cx-scrim { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(${dir}, color-mix(in srgb, ${colorVar(bp.scrim.color)} ${Math.round(bp.scrim.strength * 85)}%, transparent) 0%, transparent 60%); }`);
  }
  regions.forEach((r, i) => {
    const k = `cx-${i}`;
    const pad = r.panel && r.panel !== 'none' ? 'padding: 1.6cqmin 2.4cqmin;' : '';
    const panel = r.panel && r.panel !== 'none' ? `background: color-mix(in srgb, ${colorVar(r.panel)} ${Math.round((r.panelOpacity ?? 1) * 100)}%, transparent);` : '';
    const radius = r.radius ? `border-radius: ${r.radius / 100 * Math.min(r.w, r.h) * 2}cqmin;` : '';
    const align = r.align === 'center' ? 'center' : r.align === 'right' ? 'flex-end' : 'flex-start';
    const tone = !r.color || r.color === 'auto' ? '' : `color: ${colorVar(r.color)};`;
    const font = `font-family: var(--f-${r.font || 'text'});`;
    const weight = r.weight === 'black' ? 'font-weight: 900;' : r.weight === 'bold' ? 'font-weight: 700;' : 'font-weight: 400;';
    css.push(`.${k} { left: ${r.x}%; top: ${r.y}%; width: ${r.w}%; height: ${r.h}%; align-items: ${align}; text-align: ${r.align || 'left'}; ${pad} ${panel} ${radius} ${tone} ${font} ${weight} ${r.upper ? 'text-transform: uppercase; letter-spacing: 0.04em;' : ''} }`);
    const toneAttr = !r.color || r.color === 'auto' ? ` data-tone="auto" data-key="${k}"` : '';
    const tr = TEXT_ROLE[r.role];
    if (tr) {
      parts.push(`<div class="cx-r ${k}" data-fit-box><${tr.tag} data-field="${tr.field}" data-fit data-min="${tr.min}" data-max="${tr.max}" data-lines="${r.lines || 2}" data-fit-order="${tr.order}"${toneAttr} style="line-height:${r.role === 'headline' ? 1.02 : 1.25}"></${tr.tag}></div>`);
    } else if (r.role === 'details') {
      parts.push(
        `<div class="cx-r ${k}"${toneAttr} data-details><template><div class="d-detail cx-detail"><span data-detail-icon></span><span data-detail-text></span></div></template></div>`
      );
      css.push(`.${k} .cx-detail { display: flex; align-items: center; gap: 1.2cqmin; font-size: ${Math.max(2.1, Math.min(3.4, (r.h / Math.max(1, 3)) * 0.42))}cqmin; line-height: 1.3; justify-content: ${align}; }`);
      css.push(`.${k} .cx-detail svg { width: 1em; height: 1em; flex: none; }`);
    } else if (r.role === 'badge') {
      parts.push(`<div class="cx-r ${k}" data-badge style="align-items:center;text-align:center"><span data-badge-top></span><span data-badge-main style="font-size:2.2em;line-height:1;font-weight:900"></span><span data-badge-bottom></span></div>`);
      css.push(`.${k} { font-family: var(--f-display); font-weight: 700; font-size: ${Math.max(2.4, Math.min(5, r.h * 0.18))}cqmin; text-transform: uppercase; }`);
    } else if (r.role === 'logo') {
      parts.push(`<div class="cx-r ${k}" style="flex-direction:row;gap:2cqmin;justify-content:${align}"><div class="cx-logo" data-logo="primary"></div><div class="cx-logo" data-logo="campaign"></div></div>`);
      // The logo takes its box's height; it only gives up width when a second logo sits beside it.
      css.push(`.${k} .cx-logo { height: 100%; flex: 0 1 auto; min-width: 0; max-width: 100%; display: flex; align-items: center; } .${k} .cx-logo + .cx-logo { max-width: 45%; } .${k} .cx-logo img { height: 100%; width: auto; max-width: 100%; object-fit: contain; }`);
    } else if (r.role === 'partners') {
      parts.push(`<div class="cx-r ${k}" data-sponsors data-rows="1"><p class="cx-sp-title" data-field="sponsorsTitle"></p><div class="d-sponsor-row cx-sp-row" data-sponsor-row></div></div>`);
      // Partner logos never outweigh the main logo: the row is at most ~70% of the logo's height.
      const logoH = regions.find((x) => x.role === 'logo')?.h || 8;
      css.push(`.${k} { gap: 0.8cqmin; } .${k} .cx-sp-title { font-family: var(--f-display); font-size: 1.7cqmin; letter-spacing: 0.08em; text-transform: uppercase; } .${k} .cx-sp-row { flex: 1; width: 100%; min-height: 0; max-height: ${(logoH * 0.7).toFixed(2)}cqh; justify-content: ${align}; }`);
    } else if (r.role === 'photo') {
      parts.push(`<div class="cx-r ${k} cx-photo" data-photo="1"></div>`);
      css.push(`.${k} { overflow: hidden; } .${k} img { width: 100%; height: 100%; object-fit: cover; }`);
    } else if (r.role === 'contact') {
      parts.push(
        `<div class="cx-r ${k}"${toneAttr} style="flex-direction:row;gap:3cqmin;justify-content:${align};font-size:1.9cqmin"><p data-if="social"><span data-icon="at"></span> <span data-field="social"></span></p><p data-if="web"><span data-icon="web"></span> <span data-field="web"></span></p></div>`
      );
    }
  });
  const fields: DesignTemplate['fields'] = regions
    .map((r) => TEXT_ROLE[r.role])
    .filter(Boolean)
    .map((t) => ({ name: t!.field, required: t!.field === 'headline', max: t!.field === 'headline' ? 90 : t!.field === 'subhead' ? 200 : 60 }));
  if (regions.some((r) => r.role === 'details')) fields.push({ name: 'details' });
  if (regions.some((r) => r.role === 'badge')) fields.push({ name: 'badge' });
  if (regions.some((r) => r.role === 'partners')) fields.push({ name: 'sponsorsTitle', max: 40 });
  if (regions.some((r) => r.role === 'contact')) fields.push({ name: 'social', max: 40 }, { name: 'web', max: 40 });
  const tall = format === 'portrait' || format === 'story';
  return {
    id,
    version: 1,
    name: 'Concept',
    description: 'A layout read from an image-model concept for this poster.',
    tags: ['concept'],
    formats: tall ? [format, 'a4', 'a3'] : [format],
    fields,
    photos: { min: 0, max: regions.some((r) => r.role === 'photo') ? 1 : 0 },
    sponsors: { min: 0, max: regions.some((r) => r.role === 'partners') ? 12 : 0 },
    background: 'required',
    params: [],
    html: parts.join('\n'),
    css: css.join('\n'),
    source: 'imported'
  };
}

/** The doc a blueprint renders: the real words, logos, partners and photo, on the art layer. */
export function conceptDoc(o: {
  id: string;
  format: FormatId;
  bp: ConceptBlueprint;
  art: { url: string; width: number; height: number };
  photos: DesignDoc['photos'];
  sponsors: DesignDoc['sponsors'];
  primaryLogo: string;
  campaignLogos: string[];
  conceptUrl: string;
}): DesignDoc & { concept: { blueprint: ConceptBlueprint; conceptUrl: string } } {
  return {
    version: 1,
    designId: o.id,
    designVersion: 1,
    format: o.format,
    params: {},
    text: o.bp.copy,
    photos: o.bp.photoUse === 'real' ? o.photos.slice(0, 1) : [],
    logos: { primary: o.primaryLogo, campaign: o.campaignLogos },
    sponsors: o.bp.regions.some((r) => r.role === 'partners') ? o.sponsors : [],
    background: { url: o.art.url, width: o.art.width, height: o.art.height, prompt: 'concept art layer' },
    concept: { blueprint: o.bp, conceptUrl: o.conceptUrl }
  };
}

/** The template for a stored concept doc (edits, prints), or null for library designs. */
export function templateForConceptDoc(doc: DesignDoc): DesignTemplate | null {
  const c = (doc as any).concept;
  if (!c?.blueprint || !String(doc.designId).startsWith('concept-')) return null;
  return conceptTemplate(c.blueprint, doc.designId, doc.format === 'a4' || doc.format === 'a3' ? 'portrait' : doc.format);
}

export function brandColors(kit: BrandKit): Record<ColorRole, string> {
  return { primary: kit.colors.primary.hex, secondary: kit.colors.secondary.hex, accent: kit.colors.accent.hex, ink: kit.colors.ink.hex, paper: kit.colors.paper.hex };
}
