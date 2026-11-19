import type { DesignDoc, DesignParam, DesignTemplate } from './types';
import { FORMAT_IDS } from './formats';

/**
 * Checks a design before it is used. Designs run in a locked-down page (no scripts of their own,
 * nothing fetched from outside), and these checks keep it that way for imported designs too.
 */

const FORBIDDEN_HTML: [RegExp, string][] = [
  [/<\s*script/i, 'scripts'],
  [/<\s*(iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b/i, 'embedded or interactive elements'],
  [/\son[a-z]+\s*=/i, 'event handlers (on…=)'],
  [/javascript:/i, 'javascript: addresses'],
  [/\ssrc\s*=/i, 'src attributes (images come from slots)'],
  [/\shref\s*=/i, 'links']
];

/** Only data: SVG/PNG images, in-page references (#id) and the renderer's own files are allowed. */
function badUrls(css: string): string[] {
  const out: string[] = [];
  const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const u = m[2].trim();
    if (u.startsWith('#') || u.startsWith('data:image/svg+xml') || u.startsWith('data:image/png') || u.startsWith('https://design.local/')) continue;
    out.push(u.slice(0, 60));
  }
  return out;
}

export function validateTemplate(t: DesignTemplate): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9.-]{2,60}$/.test(t.id || '')) problems.push('The id must be 3–60 lowercase letters, digits, dots or dashes.');
  if (!t.name?.trim()) problems.push('A name is required.');
  if (!t.formats?.length || t.formats.some((f) => !FORMAT_IDS.includes(f))) problems.push('Formats must be from: ' + FORMAT_IDS.join(', '));
  if (!t.fields?.some((f) => f.name === 'headline')) problems.push('A design must show the headline.');
  for (const [re, what] of FORBIDDEN_HTML) if (re.test(t.html || '')) problems.push(`The HTML can’t contain ${what}.`);
  if (/@import/i.test(t.css || '')) problems.push('The CSS can’t import other files.');
  if (/expression\s*\(|behavior\s*:/i.test(t.css || '')) problems.push('The CSS uses unsupported features.');
  const urls = [...badUrls(t.css || ''), ...badUrls(t.html || '')];
  if (urls.length) problems.push('Outside addresses aren’t allowed: ' + urls.join(', '));
  if (!/data-field="headline"/.test(t.html || '')) problems.push('The HTML has no headline slot (data-field="headline").');
  if (!/data-logo="primary"/.test(t.html || '')) problems.push('The HTML has no place for the main logo (data-logo="primary").');
  if (t.sponsors?.max > 0 && !/data-sponsors/.test(t.html || '')) problems.push('The design takes sponsors but has no sponsor area (data-sponsors).');
  if (t.photos?.max > 0 && !/data-photo="1"/.test(t.html || '')) problems.push('The design takes photos but has no photo slot (data-photo="1").');
  if (t.background !== 'none' && !/data-bg/.test(t.html || '')) problems.push('The design takes a background but has no background area (data-bg).');
  if ((t.html || '').length > 60000 || (t.css || '').length > 60000) problems.push('The design is too large.');
  return problems;
}

/** A design's settings with defaults filled in and every value kept inside its limits. */
export function normalizeParams(params: DesignParam[], given: Record<string, unknown> = {}): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const p of params) {
    const v = given[p.key];
    if (p.type === 'number') {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
      out[p.key] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default;
    } else if (p.type === 'choice') {
      out[p.key] = typeof v === 'string' && p.options.includes(v) ? v : p.default;
    } else if (p.type === 'color') {
      out[p.key] = typeof v === 'string' && ['primary', 'secondary', 'accent', 'ink', 'paper'].includes(v) ? v : p.default;
    } else {
      out[p.key] = typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : p.default;
    }
  }
  return out;
}

/** Does this poster fit what the design can show? (Returns plain reasons when it doesn't.) */
export function fitsDesign(t: DesignTemplate, doc: Pick<DesignDoc, 'photos' | 'sponsors' | 'format' | 'background'>): string[] {
  const reasons: string[] = [];
  if (!t.formats.includes(doc.format)) reasons.push(`not made for ${doc.format}`);
  if (t.cutout === 'required' && !doc.photos[0]?.cutout) reasons.push('needs a photo with the person cut out');
  if (doc.photos.length < t.photos.min) reasons.push(`needs at least ${t.photos.min} photo${t.photos.min === 1 ? '' : 's'}`);
  if (doc.sponsors.length > t.sponsors.max) reasons.push(`shows at most ${t.sponsors.max} sponsor logos`);
  if (t.background === 'required' && !doc.background) reasons.push('needs a background picture');
  return reasons;
}

/**
 * The settings that give the words the most room: each number setting at the end it declares as
 * roomier (a smaller photo share, a deeper fade). Null when they're already there. The pipeline
 * tries this before shortening the words; the self-test does the same.
 */
export function roomierSettings(design: DesignTemplate, current: Record<string, unknown>): Record<string, number | string | boolean> | null {
  const p: Record<string, unknown> = { ...current };
  let changed = false;
  for (const def of design.params) {
    if (def.type !== 'number') continue;
    if (def.roomy) {
      const target = def.roomy === 'min' ? def.min : def.max;
      if (p[def.key] !== target) {
        p[def.key] = target;
        changed = true;
      }
      continue;
    }
    if (/^min(Photo|Art)$/.test(def.key) && p[def.key] !== def.min) {
      p[def.key] = def.min;
      changed = true;
    }
    if (def.key === 'shade' && p[def.key] !== def.max) {
      p[def.key] = def.max;
      changed = true;
    }
  }
  return changed ? normalizeParams(design.params, p) : null;
}
