import type { BrandKit, DesignDoc, DesignTemplate, DesignText, DetailLine, FormatId, PhotoSlot, SponsorSlot, BackgroundSlot } from './types';
import { FORMATS } from './formats';
import { fitsDesign, normalizeParams } from './template';
import { packById } from './packs';

/**
 * The art director: Claude reads the request, the brand and the design catalogue, writes the words
 * once, and proposes up to four options (designs and their settings) for the renderer. It never
 * draws: everything it says is data that code checks and the renderer turns into posters.
 */

export interface DirectorPhoto {
  slot: PhotoSlot;
  /** What the Library knows about it (who/what is in it). */
  description?: string;
  brightness?: number;
}

export interface DirectorInput {
  brief: string;
  caption?: string;
  campaign?: { name?: string; description?: string; coreMessages?: string } | null;
  kit: BrandKit;
  format: FormatId;
  photos: DirectorPhoto[];
  sponsors: SponsorSlot[];
  campaignLogoIds: string[];
  designs: DesignTemplate[];
  /** How many options to make (1–4). */
  count: number;
  today: Date;
}

export interface PlanCopy {
  eyebrow?: string;
  headline: string;
  subhead?: string;
  body?: string;
  details?: DetailLine[];
  cta?: string;
  footnote?: string;
  hashtag?: string;
  badge?: { top?: string; main: string; bottom?: string } | null;
  sponsorsTitle?: string;
  personLabel?: string;
  personName?: string;
  personRole?: string;
}

export interface PlanOption {
  design: string;
  params?: Record<string, unknown>;
  photos?: number[];
  background?: boolean;
  copy_changes?: Partial<Record<keyof PlanCopy, string>>;
  why?: string;
}

/** Where the people are in a photo, as the director sees it (0..1 of the photo). */
export interface PhotoNote {
  photo: number;
  subject?: { x: number; y: number; w: number; h: number };
  faces_y?: number;
  faces?: { x: number; y: number; w: number; h: number };
  people?: number;
}

export interface DirectorPlan {
  photos?: PhotoNote[];
  copy: PlanCopy;
  options: PlanOption[];
  background_prompt?: string;
  message?: string;
}

export const DIRECTOR_TOOL = {
  name: 'submit_design_plan',
  description: 'Submit the words for the poster and the options to render.',
  schema: {
    type: 'object',
    required: ['copy', 'options'],
    properties: {
      photos: {
        type: 'array',
        description: 'For each photo: where its people (or main subject) are, so crops never cut through heads and words never cover faces.',
        items: {
          type: 'object',
          required: ['photo', 'subject'],
          properties: {
            photo: { type: 'integer' },
            subject: {
              type: 'object',
              description: 'Box around all the people (or the main subject), as fractions of the photo’s width and height from the top-left.',
              required: ['x', 'y', 'w', 'h'],
              properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }
            },
            faces: {
              type: 'object',
              description: 'If there are people: the box around all their faces (heads), same fractions. Words are kept off it.',
              required: ['x', 'y', 'w', 'h'],
              properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }
            },
            people: { type: 'integer', description: 'How many people are clearly visible.' }
          }
        }
      },
      copy: {
        type: 'object',
        required: ['headline'],
        properties: {
          eyebrow: { type: 'string', description: 'Short context label above the headline (programme or occasion), 2–5 words.' },
          headline: { type: 'string', description: 'The headline. Use \\n to set the line break when the rhythm needs it.' },
          subhead: { type: 'string', description: 'One or two sentences that support the headline.' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              required: ['kind', 'text'],
              properties: { kind: { type: 'string', enum: ['date', 'time', 'place', 'phone', 'web', 'info'] }, text: { type: 'string' } }
            }
          },
          cta: { type: 'string', description: 'Call to action, 2–5 words.' },
          footnote: { type: 'string' },
          hashtag: { type: 'string' },
          badge: {
            type: 'object',
            description: 'Only for a specific date: e.g. top "Sat", main "14", bottom "Dec".',
            properties: { top: { type: 'string' }, main: { type: 'string' }, bottom: { type: 'string' } }
          },
          sponsorsTitle: { type: 'string', description: 'Words above the partner logos.' },
          personLabel: { type: 'string', description: 'When one person is featured: their part, 1–3 words, e.g. "Guest speaker", "Chief guest", "Keynote".' },
          personName: { type: 'string', description: 'The featured person’s name with title as given, e.g. "Rtr. Jane Namuli" or "PDG Sam Okello".' },
          personRole: { type: 'string', description: 'Their role, one or two short lines, e.g. "District Foundation Chair".' }
        }
      },
      options: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          required: ['design'],
          properties: {
            design: { type: 'string' },
            params: { type: 'object', additionalProperties: true },
            photos: { type: 'array', items: { type: 'integer' }, description: 'Photo numbers in the order the design uses them.' },
            background: { type: 'boolean', description: 'Use the illustration (only for designs that take one).' },
            copy_changes: { type: 'object', additionalProperties: { type: 'string' }, description: 'Fields written differently for this option only (e.g. a shorter headline).' },
            why: { type: 'string', description: 'One sentence: why this option works.' }
          }
        }
      },
      background_prompt: { type: 'string', description: 'The illustration brief for the image model, or empty when no option needs one.' },
      message: { type: 'string', description: 'A short note for the person, only if something they asked for could not be done (e.g. a brand rule).' }
    }
  }
};

export const DIRECTOR_SYSTEM = `You are the art director and copywriter of a small, excellent design studio. You prepare posters and social media pictures for clubs, charities and businesses. Code renders your decisions exactly, so you never draw: you choose designs from a catalogue, set their options, and write the words.

How you work:
1. Read the request and everything given about the brand, the campaign and the photos. Work out the one thing the poster must make people feel and do. For every photo, note in "photos" the box around its people (all of them, heads included) and the height of their faces: crops and text placement depend on it.
2. Write the words once, as a professional copywriter would:
   - Headline: short, specific and human; at most the design's limit (prefer 2–6 words). Lead with people and impact, not the organisation. Use the language of the request.
   - Eyebrow: the programme, occasion or series, 2–5 words. Leave it out if there is nothing useful.
   - Subhead: one or two plain sentences with the substance (who, what, why).
   - Details: only facts given in the request or post (dates, times, places, phone numbers, websites). Never invent a date, time, place, number, price, name or offer. Format dates like "Sat 14 December" when the weekday is certain.
   - Badge: only for one specific date (top: weekday, main: day number, bottom: month), else leave it out.
   - Call to action: 2–5 words that say what to do.
   - Featured person (speaker, chief guest, honoree, new president): put them in personLabel / personName / personRole exactly as given (titles like Rtr., PDG, DG, PP, Dr. kept), never in the headline. The headline is the event, not the name.
   - Emphasis: in the headline you may wrap one or two words in *stars* to set them in the design's accent (e.g. "World Polio *Day*"). Use it for rhythm, not decoration; not every time.
   - Never use exclamation marks unless the request does. No emoji. No hashtags unless asked.
3. Choose the options: up to the number asked for, each one a real alternative a designer would show a client.
   - Only use designs whose limits fit (photos, sponsors, formats). Prefer different designs; when only one fits, vary its settings meaningfully (colours, proportions, focus) instead.
   - Designs with a cut-out person need a photo of one person; they work best for speakers and guests.
   - Photo-led designs need a strong photo of people in action; their subject should sit where the design shows it (set focus settings from the photo's description and focal point).
   - Use the illustration (background) only in designs that take one, mainly when there is no strong photo.
   - Put the best option first.
4. If an option needs an illustration, write one background_prompt for the image model: subject, mood, style, light, a colour palette that suits the brand colours, composition matching the design's background notes. Never ask for words, letters, numbers, logos, flags or watermarks in it. Avoid realistic faces of children.

Brand rules marked HARD are enforced by the app and can never be broken: if the request asks for something they forbid, keep the rule and explain briefly in "message" what you did instead. Logos and sponsor logos are placed by code from the real files: never mention drawing them.

Return everything with the submit_design_plan tool.`;

/** The design catalogue as the director reads it. */
export function catalogText(designs: DesignTemplate[], format: FormatId): string {
  return designs
    .filter((d) => d.formats.includes(format))
    .map((d) => {
      const fields = d.fields.map((f) => `${f.name}${f.max ? ` (≤${f.max} chars)` : ''}${f.required ? ' required' : ''}`).join(', ');
      const params = d.params
        .map((p) =>
          p.type === 'number'
            ? `${p.key}: ${p.min}–${p.max} (default ${p.default}) – ${p.label}`
            : p.type === 'choice'
              ? `${p.key}: one of ${p.options.join('/')} (default ${p.default}) – ${p.label}`
              : p.type === 'color'
                ? `${p.key}: primary/secondary/accent/ink/paper (default ${p.default}) – ${p.label}`
                : `${p.key}: true/false (default ${p.default}) – ${p.label}`
        )
        .join('; ');
      return `• ${d.id} — ${d.name}: ${d.description}
  Shows: ${fields}. Photos ${d.photos.min}–${d.photos.max}${d.cutout ? ` (cut-out person ${d.cutout})` : ""}; sponsors up to ${d.sponsors.max}; illustration: ${d.background}${d.backgroundBrief ? ` (${d.backgroundBrief})` : ''}.
  Settings: ${params || 'none'}.`;
    })
    .join('\n');
}

export function brandText(kit: BrandKit): string {
  const pack = packById(kit.pack);
  const c = kit.colors;
  const lines = [
    `Brand: ${kit.name}${pack ? ` (follows the ${pack.name} brand pack)` : ''}`,
    `Colours: primary ${c.primary.name} ${c.primary.hex}; secondary ${c.secondary.name} ${c.secondary.hex}; accent ${c.accent.name} ${c.accent.hex}; text ${c.ink.hex}; paper ${c.paper.hex}.`,
    `Logos: ${kit.logos.map((l) => `${l.name} (${l.role})`).join(', ') || 'none'}.`,
    'Rules:',
    ...kit.rules.map((r) => `- ${r.hard ? 'HARD' : 'Default'}: ${r.text}`)
  ];
  if (kit.notes) lines.push(`Notes: ${kit.notes}`);
  if (pack) lines.push(`Usual words above partner logos: "${pack.sponsorsTitle}".`);
  return lines.join('\n');
}

const day = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function directorPrompt(input: DirectorInput): string {
  const f = FORMATS[input.format];
  const photos = input.photos.length
    ? input.photos
        .map((p, i) => `Photo ${i + 1}: ${p.slot.width}×${p.slot.height}, subject around ${Math.round(p.slot.focal.x * 100)}% across and ${Math.round(p.slot.focal.y * 100)}% down${p.slot.cutout ? '; its subject can be cut out (one clear person)' : ''}${p.description ? `; ${p.description}` : ''}${p.brightness !== undefined ? `; brightness ${Math.round(p.brightness * 100)}%` : ''}.`)
        .join('\n')
    : 'No photos: use designs that work without one.';
  return [
    `Today is ${day(input.today)}.`,
    `Make ${input.count} option${input.count === 1 ? '' : 's'} for a ${f.label} poster (${f.width}×${f.height}).`,
    '',
    'The request:',
    input.brief.trim() || '(none)',
    input.caption?.trim() ? `\nThe post's caption (context only):\n${input.caption.trim()}` : '',
    input.campaign?.name ? `\nCampaign: ${input.campaign.name}${input.campaign.description ? ` – ${input.campaign.description}` : ''}${input.campaign.coreMessages ? `\nKey messages: ${input.campaign.coreMessages}` : ''}` : '',
    '',
    photos,
    `Sponsors to show: ${input.sponsors.length ? input.sponsors.map((s) => s.name).join(', ') : 'none'}.`,
    `Campaign logos on the poster: ${input.campaignLogoIds.length ? input.campaignLogoIds.map((id) => input.kit.logos.find((l) => l.id === id)?.name || id).join(', ') : 'none'}.`
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const clean = (v: unknown, max = 400): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v
    .replace(/\r/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return t ? t.slice(0, max) : undefined;
};

const DETAIL_KINDS = ['date', 'time', 'place', 'phone', 'web', 'info'];

export function cleanCopy(c: any): DesignText {
  const details: DetailLine[] = Array.isArray(c?.details)
    ? c.details
        .map((d: any) => ({ kind: DETAIL_KINDS.includes(d?.kind) ? d.kind : 'info', text: clean(d?.text, 90) }))
        .filter((d: any) => d.text)
        .slice(0, 5)
    : [];
  const badgeMain = clean(c?.badge?.main, 6);
  return {
    eyebrow: clean(c?.eyebrow, 60),
    headline: clean(c?.headline, 120) || 'Untitled',
    subhead: clean(c?.subhead, 260),
    body: clean(c?.body, 400),
    details: details.length ? details : undefined,
    cta: clean(c?.cta, 60),
    footnote: clean(c?.footnote, 160),
    hashtag: clean(c?.hashtag, 40),
    badge: badgeMain ? { top: clean(c?.badge?.top, 10), main: badgeMain, bottom: clean(c?.badge?.bottom, 10) } : undefined,
    sponsorsTitle: clean(c?.sponsorsTitle, 40),
    personLabel: clean(c?.personLabel, 30),
    personName: clean(c?.personName, 70),
    personRole: clean(c?.personRole, 120),
    social: clean(c?.social, 60),
    web: clean(c?.web, 60)
  };
}

export interface PlannedOption {
  doc: DesignDoc;
  design: DesignTemplate;
  why?: string;
  wantsBackground: boolean;
}

/** Turns the director's plan into poster documents, keeping only what the designs can do. */
/** The director's view of where the people are replaces the automatic focal point. */
export function applyPhotoNotes(photos: DirectorPhoto[], notes: PhotoNote[] | undefined): DirectorPhoto[] {
  const clamp = (v: unknown, a = 0, b = 1) => Math.max(a, Math.min(b, Number(v)));
  return photos.map((p, i) => {
    const n = (notes || []).find((x) => Number(x?.photo) === i + 1);
    const s = n?.subject;
    if (!s || ![s.x, s.y, s.w, s.h].every((v) => Number.isFinite(Number(v)))) return p;
    const x = clamp(s.x);
    const y = clamp(s.y);
    const w = clamp(s.w, 0.02, 1 - x);
    const h = clamp(s.h, 0.02, 1 - y);
    if (w * h < 0.004) return p;
    // Aim at the faces when there are people (a crop keeps heads before feet), else the middle.
    const fb = n!.faces;
    const faces = fb && [fb.x, fb.y, fb.w, fb.h].every((v) => Number.isFinite(Number(v))) ? { x: clamp(fb.x), y: clamp(fb.y), w: clamp(fb.w, 0.01, 1 - clamp(fb.x)), h: clamp(fb.h, 0.01, 1 - clamp(fb.y)) } : undefined;
    const fy = faces ? faces.y + faces.h / 2 : Number.isFinite(Number(n!.faces_y)) ? clamp(n!.faces_y, y, y + h) : y + h * 0.35;
    const fx = faces ? faces.x + faces.w / 2 : x + w / 2;
    const people = Number.isFinite(Number(n!.people)) ? Math.max(0, Math.round(Number(n!.people))) : undefined;
    return { ...p, slot: { ...p.slot, focal: { x: fx, y: fy, box: { x, y, w, h }, people, faces } } };
  });
}

export function plannedDocs(plan: DirectorPlan, input: DirectorInput, background: BackgroundSlot | null): PlannedOption[] {
  input = { ...input, photos: applyPhotoNotes(input.photos, plan.photos) };
  const base = cleanCopy(plan.copy || {});
  const pack = packById(input.kit.pack);
  if (!base.sponsorsTitle && input.sponsors.length) base.sponsorsTitle = pack?.sponsorsTitle || 'With thanks to';
  if (!base.social && input.kit.contact?.social) base.social = clean(input.kit.contact.social, 60);
  if (!base.web && input.kit.contact?.web) base.web = clean(input.kit.contact.web.replace(/^https?:\/\//, '').replace(/\/$/, ''), 60);
  const primary = input.kit.logos.find((l) => l.role === 'primary');
  const out: PlannedOption[] = [];
  for (const o of (plan.options || []).slice(0, 4)) {
    const design = input.designs.find((d) => d.id === o?.design);
    if (!design) continue;
    const order = Array.isArray(o.photos) ? o.photos.map((n) => Number(n) - 1).filter((i) => i >= 0 && i < input.photos.length) : [];
    const rest = input.photos.map((_, i) => i).filter((i) => !order.includes(i));
    const photos = [...order, ...rest].slice(0, design.photos.max).map((i) => input.photos[i].slot);
    const wantsBackground = design.background !== 'none' && (o.background === true || (design.background === 'required' && !!background) || (!photos.length && !!background));
    const text: DesignText = { ...base };
    for (const [k, v] of Object.entries(o.copy_changes || {})) {
      const value = clean(v, 260);
      if (value && k in base && k !== 'details' && k !== 'badge') (text as any)[k] = value;
    }
    const doc: DesignDoc = {
      version: 1,
      designId: design.id,
      designVersion: design.version,
      format: input.format,
      params: normalizeParams(design.params, (o.params || {}) as Record<string, unknown>),
      text,
      photos,
      logos: { primary: primary?.id || 'primary', campaign: input.campaignLogoIds },
      sponsors: input.sponsors.slice(0, design.sponsors.max),
      background: wantsBackground ? background : null
    };
    if (fitsDesign(design, doc).length) continue;
    out.push({ doc, design, why: clean(o.why, 200), wantsBackground });
  }
  return out;
}

/**
 * Without an AI key the app still makes posters: the words come from the request as written and
 * the options rotate through the designs that fit.
 */
export function planWithoutAI(input: DirectorInput): DirectorPlan {
  const text = input.brief.replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let headline = sentences[0] || input.campaign?.name || 'Join us';
  if (headline.length > 60) headline = headline.split(' ').slice(0, 7).join(' ');
  const subhead = sentences.slice(1).join(' ').slice(0, 200) || undefined;
  const fitting = input.designs.filter((d) => d.formats.includes(input.format) && input.photos.length >= d.photos.min && input.sponsors.length <= d.sponsors.max && (d.cutout !== 'required' || !!input.photos[0]?.slot.cutout));
  const options: PlanOption[] = [];
  for (let i = 0; i < input.count && fitting.length; i++) options.push({ design: fitting[i % fitting.length].id, photos: [((i % Math.max(1, input.photos.length)) || 0) + 1] });
  return { copy: { headline: headline.replace(/[.!]+$/, ''), subhead, eyebrow: input.campaign?.name }, options };
}
