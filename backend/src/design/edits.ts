import type { DesignDoc, DesignTemplate, DesignText, FormatId, TextField } from './types';
import { FORMATS, isFormatId } from './formats';
import { fitsDesign, normalizeParams } from './template';
import { cleanCopy } from './director';

/**
 * Changes to a finished poster. Text typed directly into the poster is applied as it is (no AI).
 * A change described in words ("make the headline bigger", "remove the second sponsor") goes to a
 * quick model, which answers with a list of operations on the poster document; the code applies
 * them, and re-renders in seconds. The image model is only called again for a new background.
 */

export type EditOp =
  | { op: 'set_text'; field: TextField; value: string }
  | { op: 'remove_text'; field: TextField }
  | { op: 'set_details'; details: { kind: string; text: string }[] }
  | { op: 'set_badge'; badge: { top?: string; main: string; bottom?: string } | null }
  | { op: 'set_param'; key: string; value: number | string | boolean }
  | { op: 'headline_size'; scale: number }
  | { op: 'swap_colours' }
  | { op: 'switch_design'; design: string }
  | { op: 'change_format'; format: FormatId }
  | { op: 'photo_focus'; photo: number; x: number; y: number }
  | { op: 'remove_sponsor'; name: string }
  | { op: 'new_background'; prompt: string }
  | { op: 'refuse'; reason: string };

export const EDIT_TOOL = {
  name: 'submit_changes',
  description: 'The changes to make to the poster, as operations, and a one-line reply for the person.',
  schema: {
    type: 'object',
    required: ['ops', 'reply'],
    properties: {
      ops: {
        type: 'array',
        items: {
          type: 'object',
          required: ['op'],
          properties: {
            op: { type: 'string', enum: ['set_text', 'remove_text', 'set_details', 'set_badge', 'set_param', 'headline_size', 'swap_colours', 'switch_design', 'change_format', 'photo_focus', 'remove_sponsor', 'new_background', 'refuse'] },
            field: { type: 'string', enum: ['eyebrow', 'headline', 'subhead', 'body', 'cta', 'footnote', 'hashtag', 'sponsorsTitle'] },
            value: {},
            key: { type: 'string' },
            scale: { type: 'number', description: '0.75–1.3 times the fitted size (1.15 = noticeably bigger).' },
            design: { type: 'string' },
            format: { type: 'string', enum: Object.keys(FORMATS) },
            photo: { type: 'integer' },
            x: { type: 'number' },
            y: { type: 'number' },
            name: { type: 'string' },
            details: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['date', 'time', 'place', 'phone', 'web', 'info'] }, text: { type: 'string' } } } },
            badge: { type: ['object', 'null'], properties: { top: { type: 'string' }, main: { type: 'string' }, bottom: { type: 'string' } } },
            prompt: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      reply: { type: 'string', description: 'One short sentence to the person about what changed (or why not).' }
    }
  }
};

export const EDIT_SYSTEM = `You change a finished poster for a person who describes the change in words. The poster is a document (shown as JSON) rendered by code; you answer only with operations on it, using the submit_changes tool.

Operations:
- set_text {field, value}: replace the words of a field (eyebrow, headline, subhead, body, cta, footnote, hashtag, sponsorsTitle). Keep facts exactly as given; never invent dates, numbers or names. Use \\n in the headline for a line break.
- remove_text {field}
- set_details {details}: the whole list of detail lines (date, time, place, phone, web, info), in order; an empty list removes them.
- set_badge {badge}: the round badge {top, main, bottom} (e.g. SAT / 14 / DEC), or null to remove it.
- set_param {key, value}: a setting of the current design (listed with its limits).
- headline_size {scale}: 0.75–1.3; "bigger" ≈ 1.15, "much bigger" ≈ 1.3, "smaller" ≈ 0.85.
- swap_colours: swap the brand's primary and secondary colours.
- switch_design {design}: another design from the list (when the person wants a different layout).
- change_format {format}: square, portrait, story, landscape, a4, a3.
- photo_focus {photo, x, y}: where the subject of photo number "photo" is (0–1 from left/top), to move the crop.
- remove_sponsor {name}
- new_background {prompt}: only when the person wants a different illustration; describe it without any words or logos in it.
- refuse {reason}: when the request breaks a HARD brand rule (e.g. recolouring or stretching a logo, adding a second partner to a logo lockup). Say what the rule allows instead.

Logos are the real files placed by code: you can't edit them. Make the smallest set of operations that does what was asked.`;

export function editPrompt(doc: DesignDoc, design: DesignTemplate, designs: DesignTemplate[], request: string, hardRules: string[]): string {
  const params = design.params
    .map((p) => (p.type === 'number' ? `${p.key} (${p.min}–${p.max}): ${p.label}` : p.type === 'choice' ? `${p.key} (${p.options.join('/')}): ${p.label}` : p.type === 'color' ? `${p.key} (primary/secondary/accent/ink/paper): ${p.label}` : `${p.key} (true/false): ${p.label}`))
    .join('\n');
  const summary = {
    design: doc.designId,
    format: doc.format,
    settings: doc.params,
    words: doc.text,
    photos: doc.photos.map((p, i) => ({ photo: i + 1, focus: p.focal })),
    sponsors: doc.sponsors.map((s) => s.name),
    hasBackground: !!doc.background,
    tweaks: doc.tweaks || {}
  };
  return [
    `The poster now:\n${JSON.stringify(summary, null, 1)}`,
    `Settings of this design:\n${params || 'none'}`,
    `Other designs: ${designs.filter((d) => d.id !== design.id && d.formats.includes(doc.format)).map((d) => `${d.id} (${d.name})`).join(', ') || 'none'}`,
    hardRules.length ? `HARD brand rules:\n${hardRules.map((r) => `- ${r}`).join('\n')}` : '',
    `The person asks:\n${request.trim()}`
  ]
    .filter(Boolean)
    .join('\n\n');
}

const TEXT_FIELDS: TextField[] = ['eyebrow', 'headline', 'subhead', 'body', 'cta', 'footnote', 'hashtag', 'sponsorsTitle'];

export interface EditResult {
  doc: DesignDoc;
  changed: string[];
  /** A new background was asked for (the caller makes it, then renders). */
  backgroundPrompt?: string;
  refused?: string;
}

/** Applies operations to a copy of the document; unknown or invalid operations are skipped. */
export function applyEdits(doc: DesignDoc, ops: EditOp[], designs: DesignTemplate[]): EditResult {
  const next: DesignDoc = JSON.parse(JSON.stringify(doc));
  next.tweaks = next.tweaks || {};
  const changed: string[] = [];
  let backgroundPrompt: string | undefined;
  let refused: string | undefined;
  let design = designs.find((d) => d.id === next.designId);
  for (const raw of Array.isArray(ops) ? ops.slice(0, 20) : []) {
    const op: any = raw;
    switch (op?.op) {
      case 'set_text': {
        if (!TEXT_FIELDS.includes(op.field) || typeof op.value !== 'string') break;
        const cleaned = (cleanCopy({ headline: 'x', [op.field]: op.value }) as any)[op.field];
        if (cleaned) {
          (next.text as any)[op.field] = cleaned;
          next.tweaks.hide = (next.tweaks.hide || []).filter((f) => f !== op.field);
          changed.push(op.field);
        }
        break;
      }
      case 'remove_text':
        if (TEXT_FIELDS.includes(op.field) && op.field !== 'headline') {
          delete (next.text as any)[op.field];
          changed.push(op.field);
        }
        break;
      case 'set_details': {
        if (!Array.isArray(op.details)) break;
        const cleaned = cleanCopy({ headline: 'x', details: op.details }).details || [];
        if (cleaned.length) next.text.details = cleaned;
        else delete next.text.details;
        changed.push('details');
        break;
      }
      case 'set_badge': {
        if (op.badge === null || (op.badge && !String(op.badge.main || '').trim())) {
          if (next.text.badge) changed.push('badge');
          delete next.text.badge;
          break;
        }
        const badge = cleanCopy({ headline: 'x', badge: op.badge }).badge;
        if (badge) {
          next.text.badge = badge;
          changed.push('badge');
        }
        break;
      }
      case 'set_param': {
        if (!design || !design.params.some((p) => p.key === op.key)) break;
        next.params = normalizeParams(design.params, { ...next.params, [op.key]: op.value });
        changed.push(`setting ${op.key}`);
        break;
      }
      case 'headline_size': {
        const s = Number(op.scale);
        if (!Number.isFinite(s)) break;
        next.tweaks.headlineScale = Math.max(0.75, Math.min(1.3, (next.tweaks.headlineScale || 1) * s));
        changed.push('headline size');
        break;
      }
      case 'swap_colours':
        next.tweaks.colorSwap = !next.tweaks.colorSwap;
        changed.push('colours');
        break;
      case 'switch_design': {
        const d = designs.find((x) => x.id === op.design);
        if (!d) break;
        const candidate = { ...next, designId: d.id, designVersion: d.version, params: normalizeParams(d.params, {}) };
        if (fitsDesign(d, candidate).length) break;
        Object.assign(next, candidate);
        design = d;
        changed.push('design');
        break;
      }
      case 'change_format':
        if (isFormatId(op.format) && (!design || design.formats.includes(op.format))) {
          next.format = op.format;
          changed.push('format');
        }
        break;
      case 'photo_focus': {
        const i = Number(op.photo) - 1;
        const x = Number(op.x);
        const y = Number(op.y);
        if (!next.photos[i] || !Number.isFinite(x) || !Number.isFinite(y)) break;
        next.tweaks.focus = { ...(next.tweaks.focus || {}), [i]: { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } };
        changed.push('photo crop');
        break;
      }
      case 'remove_sponsor': {
        const name = String(op.name || '').toLowerCase();
        const before = next.sponsors.length;
        next.sponsors = next.sponsors.filter((s) => !s.name.toLowerCase().includes(name) || !name);
        if (next.sponsors.length !== before) changed.push('sponsors');
        break;
      }
      case 'new_background':
        if (typeof op.prompt === 'string' && op.prompt.trim()) {
          backgroundPrompt = op.prompt.trim().slice(0, 1500);
          changed.push('background');
        }
        break;
      case 'refuse':
        refused = typeof op.reason === 'string' ? op.reason.slice(0, 300) : 'That would break a brand rule.';
        break;
    }
  }
  return { doc: next, changed, backgroundPrompt, refused };
}

/** What can be typed straight into a poster: its text fields, the detail lines and the badge. */
export type TextEdits = Partial<Record<TextField, string | null>> & {
  details?: { kind: string; text: string }[];
  badge?: { top?: string; main: string; bottom?: string } | null;
};

/** Direct text edits from the poster itself (tap a line, type): no AI involved. */
export function applyTextEdits(doc: DesignDoc, text: TextEdits): DesignDoc {
  const ops: EditOp[] = [];
  if (Array.isArray(text.details)) ops.push({ op: 'set_details', details: text.details });
  if (text.badge !== undefined) ops.push({ op: 'set_badge', badge: text.badge });
  for (const [field, value] of Object.entries(text)) {
    if (!TEXT_FIELDS.includes(field as TextField)) continue;
    if (value === null || (typeof value === 'string' && !value.trim())) ops.push({ op: 'remove_text', field: field as TextField });
    else if (typeof value === 'string') ops.push({ op: 'set_text', field: field as TextField, value });
  }
  return applyEdits(doc, ops, []).doc;
}

export type { DesignText };
