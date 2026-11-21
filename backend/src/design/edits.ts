import type { DesignDoc, DesignText, TextField } from './types';
import { isFormatId } from './formats';
import { cleanCopy, coverFrame, placeFromCrop, type Box, type ColorRole, type FrameShape, type PhotoLayer, type Scene, type SceneDoc, type SceneLayer, type TextLayer, type TextRole } from './scene';

/**
 * Changes to a finished poster (a scene). Words typed on the poster and the app's one-tap buttons
 * are applied directly (no AI). A change described in words goes to a quick model, which answers
 * with the same operations; the code applies them and the poster is drawn again in seconds. The
 * image model is only called for a new backdrop picture.
 */

export type EditOp =
  | { op: 'set_text'; field: TextField; value: string }
  | { op: 'remove_text'; field: TextField }
  | { op: 'set_details'; details: { kind: string; text: string }[] }
  | { op: 'set_badge'; badge: { top?: string; main: string; bottom?: string } | null }
  | { op: 'headline_size'; scale: number }
  | { op: 'swap_colours' }
  | { op: 'change_format'; format: string }
  | { op: 'remove_sponsor'; name: string }
  | { op: 'photo_zoom'; layer?: string; scale: number }
  | { op: 'photo_move'; layer?: string; dx: number; dy: number }
  | { op: 'photo_fade'; layer?: string; side: 'left' | 'right' | 'top' | 'bottom' | 'edges' | 'none'; size?: number }
  | { op: 'photo_tint'; layer?: string; color: ColorRole | 'none'; amount?: number; mode?: 'tint' | 'duotone' | 'darken' }
  | { op: 'photo_shape'; layer?: string; shape: FrameShape }
  | { op: 'photo_breakout'; layer?: string; on: boolean; subject?: string }
  | { op: 'swap_photo'; layer?: string; url: string }
  | { op: 'move_layer'; id: string; x?: number; y?: number; w?: number; h?: number }
  | { op: 'set_color'; id: string; color?: ColorRole | 'auto'; panel?: ColorRole | 'none' }
  | { op: 'set_backdrop'; kind: 'color' | 'gradient'; color: ColorRole; to?: ColorRole; angle?: number }
  | { op: 'remove_layer'; id: string }
  | { op: 'new_backdrop'; prompt: string }
  | { op: 'refuse'; reason: string };

const COLORS = ['primary', 'secondary', 'accent', 'ink', 'paper'];
const FIELDS = ['eyebrow', 'headline', 'subhead', 'cta', 'sponsorsTitle', 'social', 'web'];

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
            op: {
              type: 'string',
              enum: ['set_text', 'remove_text', 'set_details', 'set_badge', 'headline_size', 'swap_colours', 'change_format', 'remove_sponsor', 'photo_zoom', 'photo_move', 'photo_fade', 'photo_tint', 'photo_shape', 'photo_breakout', 'move_layer', 'set_color', 'set_backdrop', 'remove_layer', 'new_backdrop', 'refuse']
            },
            field: { type: 'string', enum: FIELDS },
            value: { type: 'string' },
            details: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['date', 'time', 'place', 'phone', 'web', 'info'] }, text: { type: 'string' } } } },
            badge: { type: ['object', 'null'], properties: { top: { type: 'string' }, main: { type: 'string' }, bottom: { type: 'string' } } },
            scale: { type: 'number' },
            format: { type: 'string', enum: ['square', 'portrait', 'story', 'landscape', 'a4', 'a3'] },
            name: { type: 'string' },
            layer: { type: 'string', description: 'a photo layer id (default: the first photo)' },
            id: { type: 'string', description: 'a layer id' },
            dx: { type: 'number' },
            dy: { type: 'number' },
            side: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'edges', 'none'] },
            size: { type: 'number' },
            color: { type: 'string', enum: [...COLORS, 'auto', 'none'] },
            to: { type: 'string', enum: COLORS },
            angle: { type: 'number' },
            amount: { type: 'number' },
            mode: { type: 'string', enum: ['tint', 'duotone', 'darken'] },
            shape: { type: 'string', enum: ['rect', 'rounded', 'circle', 'arch', 'slant-left', 'slant-right', 'blob'] },
            on: { type: 'boolean' },
            subject: { type: 'string' },
            kind: { type: 'string', enum: ['color', 'gradient'] },
            panel: { type: 'string', enum: [...COLORS, 'none'] },
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
            prompt: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      reply: { type: 'string', description: 'One short sentence to the person about what changed (or why not).' }
    }
  }
};

export const EDIT_SYSTEM = `You change a finished poster for a person who describes the change in words. The poster is a scene of layers (shown as JSON, back to front) drawn by code; you answer only with operations, using the submit_changes tool. Positions are % of the poster's width (x, w) and height (y, h).

Operations:
- set_text {field, value} / remove_text {field}: eyebrow, headline, subhead, cta, sponsorsTitle, social, web. Keep facts exactly; never invent dates, numbers or names. \\n for a headline line break.
- set_details {details}: the whole list of detail lines (date, time, place, phone, web, info); empty removes them.
- set_badge {badge}: {top, main, bottom} (e.g. SAT / 14 / DEC) or null.
- headline_size {scale}: "bigger" ≈ 1.15, "smaller" ≈ 0.85.
- swap_colours: swap the brand's primary and secondary colours.
- change_format {format}: square, portrait, story, landscape, a4, a3.
- remove_sponsor {name}
- photo_zoom {layer, scale}: "closer" ≈ 1.25, "show more" ≈ 0.8.
- photo_move {layer, dx, dy}: shift what the frame shows, in % of the frame (dx > 0 shows more of the right side, dy > 0 more of the bottom).
- photo_fade {layer, side, size}: a soft edge (size % of the frame); side "none" removes it.
- photo_tint {layer, color, amount, mode}: a brand-colour wash; color "none" removes it.
- photo_shape {layer, shape}: rect, rounded, circle, arch, slant-left, slant-right, blob.
- photo_breakout {layer, on, subject}: the people stand out over the frame's top edge.
- move_layer {id, x, y, w, h}: move or resize any layer.
- set_color {id, color, panel}: a text layer's colour ("auto" = light or dark for what's behind) or panel; a shape's colour.
- set_backdrop {kind, color, to, angle}: a plain colour or gradient ground instead of the current one.
- remove_layer {id}: a shape, a text layer other than the headline, or a photo.
- new_backdrop {prompt}: only when the person wants a different background picture; describe it without words, logos or people.
- refuse {reason}: when the request breaks a HARD brand rule (recolouring or stretching a logo…). Say what's allowed instead.

Colours are only the brand's (primary, secondary, accent, ink, paper). Logos are real files placed by code. Make the smallest set of operations that does what was asked.`;

/** The scene in short, for the quick model. */
export function editPrompt(doc: SceneDoc, request: string, hardRules: string[]): string {
  const s = doc.scene;
  const r = (v: number) => Math.round(v * 10) / 10;
  const box = (b: Box) => ({ x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) });
  const layers = s.layers.map((l) => {
    if (l.type === 'photo') return { id: l.id, type: 'photo', frame: box(l.frame), shape: l.shape, fade: l.fade, tint: l.tint, breakout: l.breakout || undefined };
    if (l.type === 'text') return { id: l.id, type: 'text', role: l.role, box: box(l.box), color: l.color, panel: l.panel };
    if (l.type === 'shape') return { id: l.id, type: 'shape', box: box(l.box), color: l.color, shape: l.shape };
    return { id: l.id, type: l.type, box: box(l.box) };
  });
  const summary = { format: doc.format, backdrop: s.backdrop, layers, words: doc.text, partners: doc.sponsors.map((x) => x.name), tweaks: doc.tweaks || {} };
  return [`The poster now:\n${JSON.stringify(summary)}`, hardRules.length ? `HARD brand rules:\n${hardRules.map((x) => `- ${x}`).join('\n')}` : '', `The person asks:\n${request.trim()}`].filter(Boolean).join('\n\n');
}

export interface EditResult {
  doc: SceneDoc;
  changed: string[];
  /** A new backdrop picture was asked for (the caller makes it, then draws). */
  backdropPrompt?: string;
  /** Cut-outs to make (photo layer ids) before drawing. */
  needCutouts?: string[];
  /** A photo to swap in (the caller loads it, then draws). */
  swap?: { layer: string; url: string };
  refused?: string;
}

const ROLE_OF: Partial<Record<string, TextRole>> = { eyebrow: 'eyebrow', headline: 'headline', subhead: 'subhead', cta: 'cta', social: 'contact', web: 'contact' };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A text layer for a field that has none yet: under the headline, or above it if there's no room. */
function ensureTextLayer(scene: Scene, role: TextRole): void {
  if (scene.layers.some((l) => l.type === 'text' && l.role === role)) return;
  const head = scene.layers.find((l): l is TextLayer => l.type === 'text' && l.role === 'headline');
  const h = role === 'subhead' ? 8 : role === 'details' ? 12 : role === 'cta' ? 6 : 4.5;
  const base = head ? head.box : { x: 7, y: 20, w: 86, h: 20 };
  const y = base.y + base.h + 1.5 + h <= 96 ? base.y + base.h + 1.5 : Math.max(3, base.y - h - 1.5);
  const layer: TextLayer = {
    type: 'text',
    id: role,
    role,
    box: { x: base.x, y, w: role === 'cta' ? Math.min(44, base.w) : base.w, h },
    align: head?.align || 'left',
    color: role === 'cta' ? 'ink' : head?.color || 'auto',
    panel: role === 'cta' ? 'accent' : 'none',
    radius: role === 'cta' ? 50 : 0,
    weight: role === 'subhead' ? 'regular' : 'bold',
    font: role === 'subhead' ? 'text' : 'display',
    lines: role === 'subhead' ? 3 : 2
  };
  const firstFront = scene.layers.findIndex((l) => l.type !== 'shape' && l.type !== 'photo');
  scene.layers.splice(firstFront < 0 ? scene.layers.length : firstFront, 0, layer);
}

function photoLayer(scene: Scene, id?: string): PhotoLayer | undefined {
  const photos = scene.layers.filter((l): l is PhotoLayer => l.type === 'photo');
  return (id && photos.find((p) => p.id === id)) || photos[0];
}

function ensurePlace(scene: Scene, l: PhotoLayer, doc: DesignDoc): Box | null {
  const p = doc.photos[l.photo];
  if (!p) return null;
  if (!l.place) l.place = placeFromCrop(l.frame, scene.aspect, p, l.crop);
  return l.place;
}

/** Applies operations to a copy of the poster; unknown or invalid operations are skipped. */
export function applyEdits(doc: SceneDoc, ops: EditOp[]): EditResult {
  const next: SceneDoc = JSON.parse(JSON.stringify(doc));
  const scene = next.scene;
  next.tweaks = next.tweaks || {};
  const changed: string[] = [];
  const result: EditResult = { doc: next, changed };
  const setCopy = (field: string, value: unknown) => {
    if (value === undefined) {
      delete (next.text as any)[field];
      delete (scene.copy as any)[field];
    } else {
      (next.text as any)[field] = value;
      (scene.copy as any)[field] = value;
    }
  };
  for (const raw of Array.isArray(ops) ? ops.slice(0, 20) : []) {
    const op: any = raw;
    switch (op?.op) {
      case 'set_text': {
        if (!FIELDS.includes(op.field) || typeof op.value !== 'string') break;
        const cleaned = (cleanCopy({ headline: 'x', [op.field]: op.value }) as any)[op.field];
        if (!cleaned) break;
        setCopy(op.field, cleaned);
        const role = ROLE_OF[op.field];
        if (role) ensureTextLayer(scene, role);
        next.tweaks.hide = (next.tweaks.hide || []).filter((f) => f !== op.field);
        changed.push(op.field);
        break;
      }
      case 'remove_text':
        if (FIELDS.includes(op.field) && op.field !== 'headline') {
          setCopy(op.field, undefined);
          changed.push(op.field);
        }
        break;
      case 'set_details': {
        if (!Array.isArray(op.details)) break;
        const cleaned = cleanCopy({ headline: 'x', details: op.details }).details || [];
        setCopy('details', cleaned.length ? cleaned : undefined);
        if (cleaned.length) ensureTextLayer(scene, 'details');
        changed.push('details');
        break;
      }
      case 'set_badge': {
        if (op.badge === null || (op.badge && !String(op.badge.main || '').trim())) {
          if (next.text.badge) changed.push('badge');
          setCopy('badge', undefined);
          break;
        }
        const badge = cleanCopy({ headline: 'x', badge: op.badge }).badge;
        if (badge) {
          setCopy('badge', badge);
          ensureTextLayer(scene, 'badge');
          changed.push('badge');
        }
        break;
      }
      case 'headline_size': {
        const s = Number(op.scale);
        if (!Number.isFinite(s)) break;
        next.tweaks.headlineScale = clamp((next.tweaks.headlineScale || 1) * s, 0.75, 1.3);
        changed.push('headline size');
        break;
      }
      case 'swap_colours':
        next.tweaks.colorSwap = !next.tweaks.colorSwap;
        changed.push('colours');
        break;
      case 'change_format':
        if (isFormatId(op.format) && op.format !== next.format) {
          next.format = op.format;
          changed.push('format');
        }
        break;
      case 'remove_sponsor': {
        const name = String(op.name || '').toLowerCase();
        const before = next.sponsors.length;
        next.sponsors = next.sponsors.filter((s) => !name || !s.name.toLowerCase().includes(name));
        if (next.sponsors.length !== before) changed.push('partners');
        break;
      }
      case 'photo_zoom': {
        const l = photoLayer(scene, op.layer);
        const s = Number(op.scale);
        const place = l && ensurePlace(scene, l, next);
        if (!l || !place || !Number.isFinite(s) || s <= 0) break;
        const k = clamp(s, 0.4, 2.5);
        const cx = place.x + place.w / 2;
        const cy = place.y + place.h / 2;
        const p = next.photos[l.photo];
        l.place = coverFrame({ x: cx - (place.w * k) / 2, y: cy - (place.h * k) / 2, w: place.w * k, h: place.h * k }, l.frame, scene.aspect, p.width / p.height);
        l.crop = undefined;
        changed.push('photo zoom');
        break;
      }
      case 'photo_move': {
        const l = photoLayer(scene, op.layer);
        const place = l && ensurePlace(scene, l, next);
        const dx = Number(op.dx) || 0;
        const dy = Number(op.dy) || 0;
        if (!l || !place || (!dx && !dy)) break;
        const p = next.photos[l.photo];
        l.place = coverFrame({ ...place, x: place.x - (dx / 100) * l.frame.w, y: place.y - (dy / 100) * l.frame.h }, l.frame, scene.aspect, p.width / p.height);
        l.crop = undefined;
        changed.push('photo position');
        break;
      }
      case 'photo_fade': {
        const l = photoLayer(scene, op.layer);
        if (!l) break;
        l.fade = op.side === 'none' || !op.side ? undefined : { side: op.side, size: clamp(Number(op.size) || 25, 5, 70) };
        changed.push('photo fade');
        break;
      }
      case 'photo_tint': {
        const l = photoLayer(scene, op.layer);
        if (!l) break;
        l.tint = op.color === 'none' || !COLORS.includes(op.color) ? undefined : { color: op.color, amount: clamp(Number(op.amount) || 0.35, 0.05, 0.9), mode: ['tint', 'duotone', 'darken'].includes(op.mode) ? op.mode : 'tint' };
        changed.push('photo colour');
        break;
      }
      case 'photo_shape': {
        const l = photoLayer(scene, op.layer);
        if (!l || !['rect', 'rounded', 'circle', 'arch', 'slant-left', 'slant-right', 'blob'].includes(op.shape)) break;
        l.shape = op.shape;
        l.mask = undefined;
        if (op.shape === 'rounded' && !l.radius) l.radius = 6;
        changed.push('photo shape');
        break;
      }
      case 'photo_breakout': {
        const l = photoLayer(scene, op.layer);
        if (!l) break;
        l.breakout = op.on ? 'top' : null;
        if (op.on) {
          if (typeof op.subject === 'string' && op.subject.trim()) l.subject = op.subject.trim().slice(0, 120);
          result.needCutouts = [...(result.needCutouts || []), l.id];
        }
        changed.push('people over the frame');
        break;
      }
      case 'swap_photo': {
        const l = photoLayer(scene, op.layer);
        if (!l || typeof op.url !== 'string' || !op.url) break;
        result.swap = { layer: l.id, url: op.url };
        changed.push('photo');
        break;
      }
      case 'move_layer': {
        const l = scene.layers.find((x) => x.id === op.id);
        if (!l) break;
        const b: Box = l.type === 'photo' ? l.frame : l.box;
        const nb = { x: Number.isFinite(op.x) ? op.x : b.x, y: Number.isFinite(op.y) ? op.y : b.y, w: Number.isFinite(op.w) ? op.w : b.w, h: Number.isFinite(op.h) ? op.h : b.h };
        const bleed = l.type === 'photo' || l.type === 'shape';
        const fixed = bleed ? { x: clamp(nb.x, -50, 100), y: clamp(nb.y, -50, 100), w: clamp(nb.w, 2, 200), h: clamp(nb.h, 2, 200) } : { x: clamp(nb.x, 0, 96), y: clamp(nb.y, 0, 96), w: clamp(nb.w, 3, 100), h: clamp(nb.h, 2, 100) };
        if (!bleed) {
          fixed.w = Math.min(fixed.w, 100 - fixed.x);
          fixed.h = Math.min(fixed.h, 100 - fixed.y);
        }
        if (l.type === 'photo') {
          const dx = fixed.x - l.frame.x;
          const dy = fixed.y - l.frame.y;
          l.frame = fixed;
          const p = next.photos[l.photo];
          if (l.place && p) l.place = coverFrame({ ...l.place, x: l.place.x + dx, y: l.place.y + dy }, fixed, scene.aspect, p.width / p.height);
        } else (l as Exclude<SceneLayer, PhotoLayer>).box = fixed;
        changed.push(`${l.type} position`);
        break;
      }
      case 'set_color': {
        const l = scene.layers.find((x) => x.id === op.id);
        if (!l) break;
        if (l.type === 'text') {
          if (op.color && (COLORS.includes(op.color) || op.color === 'auto')) l.color = op.color;
          if (op.panel && (COLORS.includes(op.panel) || op.panel === 'none')) l.panel = op.panel;
        } else if (l.type === 'shape' && COLORS.includes(op.color)) l.color = op.color;
        else break;
        changed.push('colour');
        break;
      }
      case 'set_backdrop':
        if (op.kind === 'color' && COLORS.includes(op.color)) scene.backdrop = { kind: 'color', color: op.color };
        else if (op.kind === 'gradient' && COLORS.includes(op.color) && COLORS.includes(op.to)) scene.backdrop = { kind: 'gradient', from: op.color, to: op.to, angle: clamp(Number(op.angle) || 180, 0, 360) };
        else break;
        next.background = null;
        changed.push('background');
        break;
      case 'remove_layer': {
        const i = scene.layers.findIndex((x) => x.id === op.id);
        const l = scene.layers[i];
        if (!l || l.type === 'logo' || (l.type === 'text' && l.role === 'headline')) break;
        scene.layers.splice(i, 1);
        changed.push(`${l.type} removed`);
        break;
      }
      case 'new_backdrop':
        if (typeof op.prompt === 'string' && op.prompt.trim()) {
          result.backdropPrompt = op.prompt.trim().slice(0, 1500);
          changed.push('background picture');
        }
        break;
      case 'refuse':
        result.refused = typeof op.reason === 'string' ? op.reason.slice(0, 300) : 'That would break a brand rule.';
        break;
    }
  }
  return result;
}

/** What can be typed straight into a poster: its text fields, the detail lines and the badge. */
export type TextEdits = Partial<Record<TextField, string | null>> & {
  details?: { kind: string; text: string }[];
  badge?: { top?: string; main: string; bottom?: string } | null;
};

/** Direct text edits from the poster itself (tap a line, type): no AI involved. */
export function applyTextEdits(doc: SceneDoc, text: TextEdits): SceneDoc {
  const ops: EditOp[] = [];
  if (Array.isArray(text.details)) ops.push({ op: 'set_details', details: text.details });
  if (text.badge !== undefined) ops.push({ op: 'set_badge', badge: text.badge });
  for (const [field, value] of Object.entries(text)) {
    if (!FIELDS.includes(field)) continue;
    if (value === null || (typeof value === 'string' && !value.trim())) ops.push({ op: 'remove_text', field: field as TextField });
    else if (typeof value === 'string') ops.push({ op: 'set_text', field: field as TextField, value });
  }
  return applyEdits(doc, ops).doc;
}

export type { DesignText };
