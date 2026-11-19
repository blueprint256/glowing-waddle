import { recap } from './library/recap';
import { FORMAT_IDS } from './formats';
import type { DesignTemplate } from './types';

/**
 * Turning a reference poster into a library design (admin): Claude Opus reads the reference and
 * writes an ORIGINAL parametric design for the runtime that captures its structure (grid, hierarchy,
 * proportions, the way photo and words meet), never its artwork, logos, photos or words. The design
 * then goes through the stress test; failures and previews go back for up to two repairs. A person
 * approves it before the art director can use it.
 */

export const IMPORT_TOOL = {
  name: 'submit_design',
  description: 'Submit the design: its description for the art director, its limits, settings, HTML and CSS.',
  schema: {
    type: 'object',
    required: ['id', 'name', 'description', 'tags', 'formats', 'fields', 'photos', 'sponsors', 'background', 'params', 'html', 'css'],
    properties: {
      id: { type: 'string', description: 'lowercase-with-dashes, 3–60 characters, unique, e.g. "framed-band".' },
      name: { type: 'string', description: 'Two or three words.' },
      description: { type: 'string', description: 'For the art director: what it looks like, what it suits, what it needs (photo kind, how much text). 2–4 sentences.' },
      tags: { type: 'array', items: { type: 'string' } },
      formats: { type: 'array', items: { type: 'string', enum: FORMAT_IDS } },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', enum: ['eyebrow', 'headline', 'subhead', 'body', 'details', 'cta', 'footnote', 'hashtag', 'badge', 'sponsorsTitle', 'personLabel', 'personName', 'personRole', 'social', 'web', 'stats'] },
            required: { type: 'boolean' },
            max: { type: 'number', description: 'Most characters that fit comfortably.' }
          }
        }
      },
      photos: { type: 'object', required: ['min', 'max'], properties: { min: { type: 'number' }, max: { type: 'number' } } },
      cutout: { type: 'string', enum: ['none', 'preferred', 'required'] },
      sponsors: { type: 'object', required: ['min', 'max'], properties: { min: { type: 'number' }, max: { type: 'number' } } },
      background: { type: 'string', enum: ['none', 'optional', 'required'] },
      backgroundBrief: { type: 'string', description: 'If it takes a background picture: what kind of art fits and where its quiet area must be (given to the image model).' },
      backgroundArea: { type: 'object', description: 'If it takes a background: the share of the poster it covers.', properties: { w: { type: 'number' }, h: { type: 'number' } } },
      params: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key', 'label', 'type', 'default'],
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            type: { type: 'string', enum: ['number', 'color', 'toggle', 'choice'] },
            min: { type: 'number' },
            max: { type: 'number' },
            step: { type: 'number' },
            options: { type: 'array', items: { type: 'string' } },
            default: {},
            roomy: { type: 'string', enum: ['min', 'max'], description: 'Numbers only: which end gives the words more room.' }
          }
        }
      },
      html: { type: 'string' },
      css: { type: 'string' },
      notes: { type: 'string', description: 'What you changed from the reference and why (for the admin).' }
    }
  }
};

const EXAMPLE = JSON.stringify(
  {
    id: recap.id,
    name: recap.name,
    description: recap.description,
    tags: recap.tags,
    formats: recap.formats,
    fields: recap.fields,
    photos: recap.photos,
    sponsors: recap.sponsors,
    background: recap.background,
    params: recap.params,
    html: recap.html.trim(),
    css: recap.css.trim()
  },
  null,
  1
);

export const IMPORT_SYSTEM = `You are a senior poster designer and front-end engineer. You turn a reference poster into an ORIGINAL, reusable poster design for a rendering engine. Clubs (Rotary, Rotaract, charities, small businesses) will fill it with their own words, photos and logos, in six shapes, with anywhere from no partners to nine.

What to take from the reference, and what never to take:
- Take its structure: the grid, the proportions, the hierarchy (what is biggest, what is grouped), how photo and words meet (overlap, cut, fade, frame, band), the rhythm of spacing, the kind of type (condensed, serif, weight contrasts), the role of colour (ground, accent, panels).
- Never copy its artwork, illustrations, photos, logos, brand names, slogans or words. Never reproduce a recognisable brand's signature look. Colours and fonts always come from the club's brand kit through the variables below, never from the reference.
- Improve on it where it is weak: contrast, cramped margins, uneven logo sizes, words over busy photo areas, too many fonts.

The engine (read carefully: anything not listed here does not exist):
- The poster is #poster, a container with container units: use cqw, cqh, cqmin for every size (cqmin = 1% of the short side). Never px. Shapes: square 1080×1080, portrait 1080×1350, story 1080×1920, landscape 1200×800, a4 and a3 1240×1754. #poster has data-format="square|portrait|story|landscape|a4|a3": write shape-specific rules with #poster[data-format="…"]. Every shape you list in "formats" must work.
- No scripts, no event handlers, no <img>, <iframe>, <link>, <style> or url() to the outside. Only the HTML and CSS you return. Prefix every class with a short design prefix (e.g. "fb-").
- Brand variables: --c-primary, --c-secondary, --c-accent, --c-ink (dark text), --c-paper (light ground), --c-primary-deep, --c-primary-mid, --c-primary-soft, --c-primary-tint, --c-secondary-soft, --c-accent-deep, --c-accent-soft, --c-paper-warm; rgb triplets --c-ink-rgb, --c-primary-deep-rgb (use as rgb(var(--c-ink-rgb) / 0.2)); fonts --f-display, --f-text, --f-accent; --on-primary, --on-secondary, --on-accent, --on-deep (readable text on those); --shadow-soft.
- Settings ("params"): each becomes --p-<key>. A color setting holds a brand colour; --p-<key>-on is readable text on it, and --p-<a>-on-<b> is colour a where it reads on colour b (b = another color setting, "paper" or "deep"), otherwise a readable text colour. Use these for every text colour on a coloured ground. Number settings are plain numbers (use calc(var(--p-x) * 100cqh)). Give settings that change room for the words "roomy" (which end gives more room).
- Words: <h1 data-field="headline"> etc. for eyebrow, headline, subhead, body, cta, footnote, hashtag, sponsorsTitle, personLabel, personName, personRole, social, web. Elements with an empty field are removed. *Stars* in the headline become <em> (style #poster em for the emphasis). data-case="upper" uppercases.
- Fitting type: data-fit data-min="4.6" data-max="9" data-lines="3" data-fit-order="1" (sizes in cqmin). The engine sizes each from min upwards, in order, as large as its box allows; the box is the nearest ancestor with data-fit-box (it must have a fixed size: flex with min-height:0 and overflow:hidden, or absolute insets). data-fit-group="name" gives several elements one shared size. Minimum readable sizes (cqmin): headline 4.5, subhead 2.2, details 2, cta 2.2, eyebrow 1.75, footnote/social/web 1.55, sponsorsTitle 1.45. Never set data-min below these.
- Details: <div data-details><template><div class="d-detail x-detail"><span data-detail-icon></span><span data-detail-text></span></div></template></div> (date, time, place lines with drawn icons). Figures: <div data-stats><template><div><b data-stat-value></b><span data-stat-label></span></div></template></div>. Date badge: an element with data-badge containing elements with data-badge-top, data-badge-main, data-badge-bottom. Icons: <span data-icon="date|time|place|phone|web|at|info"></span>.
- Photos: <div data-photo="1" data-focus-x="0.5" data-focus-y="0.45"></div> (a box; the engine places the photo to cover it, keeping its subject at the focus point; "param:key" reads a setting). Classes on the box: t-unify (gentle grade), t-duotone (brand duotone), t-shade, t-tint. --photo-1-ar is the photo's width/height. A cut-out person: <div data-cutout="1" data-stand></div> (stands on the box's bottom; only with "cutout"). Background picture: <div data-bg></div> (only if background isn't "none").
- Logos (placed by the engine from the real files, never drawn): <div data-logo="primary"></div> and <div data-logo="campaign"></div> with a height in CSS and data-surface="light|dark|auto" (the ground under it; the engine picks the logo version that reads, or a plate). Give logos clear space: nothing within var(--clear-primary) × their height. The club logo must be at least 6cqmin tall.
- Partners: <div data-sponsors data-rows="2"><p data-field="sponsorsTitle"></p><div class="d-sponsor-row" data-sponsor-row></div></div>. The row needs a fixed height (flex: none; height: …) and full width; the engine sizes the logos inside so each looks equally important. Put partners on a quiet ground (a white band is the convention), up to nine in one row.
- Conditions: data-if="photos", "!subhead", "photos>=2", "sponsors", "details", "stats", "campaign", "cutout", "background", "person", "contact", "param:key", "format:story|portrait", combined with & and |. Missing parts are removed, so layouts must still look complete without them (no photo, no partners, no subhead).
- Measured positions: data-measure="name" publishes --name-top, --name-bottom, --name-left, --name-right, --name-h (px) on #poster, so a fade or a badge can follow where the words really are.
- Helpers: d-grain (subtle grain layer, give it a z-index), d-balance and d-pretty (nicer line breaks), d-shadow, d-fill (absolute inset 0).

The engine checks every render: words that overflow, are too small, low contrast (4.5:1, measured on the actual pixels), overlap, are covered by something, cross a photo's edge, sit on faces; logos too small, cut off, in each other's clear space; partners outweighing the club logo. Design so these pass in every shape with ordinary words, with no partners and with six partners.

A complete built-in design, as an example of the format and the quality expected:
${EXAMPLE}

Return the design with the submit_design tool. Make it as polished as the best poster in its category: generous margins, one clear focal point, a strict grid, at most two typefaces (display and text, plus the accent for emphasis), and space for the photo to breathe.`;

export function importPrompt(input: { note?: string; name?: string }): string {
  return [
    'Turn this reference into an original design for the library.',
    input.name ? `Call it "${input.name}".` : '',
    input.note?.trim() ? `What the admin wants from it:\n${input.note.trim()}` : '',
    'Describe in "notes" what you took from the reference and what you changed.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function repairPrompt(design: DesignTemplate, problems: string[], request?: string): string {
  const current = JSON.stringify({ ...design, source: undefined }, null, 1);
  return [
    request?.trim() ? `The admin asks for this change:\n${request.trim()}` : 'The stress test found problems. Fix them all, keeping the design’s character.',
    problems.length ? `Problems from the stress test (each a shape and a case):\n- ${problems.slice(0, 30).join('\n- ')}` : '',
    'The renders are attached (one per shape, ordinary words with six partners).',
    `The design as it stands:\n${current}`,
    'Return the whole corrected design with the submit_design tool (same id).'
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The importer's answer as a design (shape only; validateTemplate decides whether it's usable). */
export function designFromImport(input: any): DesignTemplate {
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const id = String(input?.id || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const params = (Array.isArray(input?.params) ? input.params : [])
    .filter((p: any) => p && typeof p.key === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(p.key))
    .slice(0, 12)
    .map((p: any) => {
      const base = { key: p.key, label: String(p.label || p.key).slice(0, 80) };
      if (p.type === 'number') {
        const min = num(p.min, 0);
        const max = Math.max(min, num(p.max, 1));
        return { ...base, type: 'number', min, max, step: num(p.step, (max - min) / 20 || 0.01), default: Math.min(max, Math.max(min, num(p.default, min))), ...(p.roomy === 'min' || p.roomy === 'max' ? { roomy: p.roomy } : {}) };
      }
      if (p.type === 'color') return { ...base, type: 'color', default: ['primary', 'secondary', 'accent', 'ink', 'paper'].includes(p.default) ? p.default : 'primary' };
      if (p.type === 'choice') {
        const options = (Array.isArray(p.options) ? p.options : []).map(String).slice(0, 8);
        return { ...base, type: 'choice', options, default: options.includes(String(p.default)) ? String(p.default) : options[0] || '' };
      }
      return { ...base, type: 'toggle', default: Boolean(p.default) };
    });
  return {
    id,
    version: 1,
    name: String(input?.name || id).slice(0, 60),
    description: String(input?.description || '').slice(0, 1200),
    tags: (Array.isArray(input?.tags) ? input.tags : []).map(String).slice(0, 12),
    formats: (Array.isArray(input?.formats) ? input.formats : []).filter((f: any) => FORMAT_IDS.includes(f)),
    fields: (Array.isArray(input?.fields) ? input.fields : [])
      .filter((f: any) => f && typeof f.name === 'string')
      .map((f: any) => ({ name: f.name, ...(f.required ? { required: true } : {}), ...(Number.isFinite(Number(f.max)) && f.max ? { max: Math.round(Number(f.max)) } : {}) })),
    photos: { min: Math.max(0, Math.round(num(input?.photos?.min, 0))), max: Math.max(0, Math.min(3, Math.round(num(input?.photos?.max, 1)))) },
    ...(input?.cutout === 'preferred' || input?.cutout === 'required' ? { cutout: input.cutout } : {}),
    sponsors: { min: 0, max: Math.max(0, Math.min(9, Math.round(num(input?.sponsors?.max, 8)))) },
    background: ['none', 'optional', 'required'].includes(input?.background) ? input.background : 'none',
    ...(typeof input?.backgroundBrief === 'string' && input.backgroundBrief.trim() ? { backgroundBrief: input.backgroundBrief.slice(0, 600) } : {}),
    ...(input?.backgroundArea && Number(input.backgroundArea.w) > 0 && Number(input.backgroundArea.h) > 0
      ? { backgroundArea: { w: Math.min(1, Number(input.backgroundArea.w)), h: Math.min(1, Number(input.backgroundArea.h)) } }
      : {}),
    params,
    html: String(input?.html || ''),
    css: String(input?.css || '')
  } as DesignTemplate;
}
