import type { BrandKit, DesignDoc, DesignIssue, DesignTemplate, MeasuredElement, RenderReport } from './types';

/**
 * The code checks run on every rendered poster, before any AI looks at it. They are exact and free:
 * text that doesn't fit, words that are too small or hard to read, logos that are too small or
 * crowded inside their clear space, sponsors that outweigh the club logo, things pushed off the
 * edge. Errors make an option unusable (it is fixed or dropped); warnings lower its rank.
 */

type Box = MeasuredElement['box'];

const intersects = (a: Box, b: Box, pad = 0) => a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const contains = (outer: Box, inner: Box, slack = 1) => inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;

/** Smallest readable size per field, as a share of the poster's short side. */
const MIN_SIZE: Record<string, number> = {
  headline: 0.045,
  eyebrow: 0.0175,
  subhead: 0.022,
  body: 0.02,
  cta: 0.022,
  details: 0.02,
  footnote: 0.0155,
  hashtag: 0.018,
  sponsorsTitle: 0.0145,
  personLabel: 0.0145,
  personName: 0.024,
  personRole: 0.017,
  social: 0.0155,
  web: 0.0155
};

const FIELD_LABEL: Record<string, string> = {
  headline: 'headline',
  eyebrow: 'small label above the headline',
  subhead: 'subheading',
  body: 'text',
  cta: 'call to action',
  footnote: 'small print',
  hashtag: 'hashtag',
  sponsorsTitle: 'sponsor heading',
  personLabel: 'label above the name',
  personName: 'name',
  personRole: 'role under the name',
  social: 'handle',
  web: 'website'
};

function label(el: MeasuredElement): string {
  const f = el.field || el.key;
  if (f.startsWith('detail-')) return `“${f.slice(7)}” line`;
  return FIELD_LABEL[f] || f;
}

export interface CheckInput {
  template: DesignTemplate;
  doc: DesignDoc;
  kit: BrandKit;
  report: RenderReport;
  contrasts: Map<string, number>;
}

export function runChecks({ template, doc, kit, report, contrasts }: CheckInput): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const short = Math.min(report.width, report.height);
  const poster: Box = { x: 0, y: 0, w: report.width, h: report.height };
  const els = report.elements;
  const texts = els.filter((e) => e.kind === 'text');
  const logos = els.filter((e) => e.kind === 'logo');
  const sponsors = els.filter((e) => e.kind === 'sponsor');
  const badges = els.filter((e) => e.kind === 'badge');

  // Words.
  for (const t of texts) {
    const field = (t.field || t.key).startsWith('detail-') ? 'details' : t.field || t.key;
    if (t.overflow) issues.push({ level: 'error', code: 'text-overflow', key: t.key, message: `The ${label(t)} doesn’t fit its space.` });
    // Words lying on the cut-out person: a little at the very edge is tolerated, more never.
    if (t.overSubject) issues.push({ level: 'error', code: 'text-over-subject', key: t.key, message: `The ${label(t)} covers the photo’s subject.` });
    if ((t.overPerson || 0) > 0.06) issues.push({ level: (t.overPerson || 0) > 0.15 ? 'error' : 'warning', code: 'text-over-person', key: t.key, message: `The ${label(t)} runs over the person.` });
    const min = MIN_SIZE[field];
    if (min && t.fontSize && t.fontSize < min * short - 0.25) {
      issues.push({ level: field === 'headline' ? 'error' : 'warning', code: 'text-small', key: t.key, message: `The ${label(t)} is too small to read comfortably (${Math.round(t.fontSize)} px).` });
    }
    const c = contrasts.get(t.key);
    if (c !== undefined) {
      const large = (t.fontSize || 0) >= 0.034 * short;
      const need = large ? 3 : 4.5;
      if (c < need) issues.push({ level: c < need * 0.75 ? 'error' : 'warning', code: 'contrast', key: t.key, message: `The ${label(t)} is hard to read against what’s behind it (contrast ${c}:1, needs ${need}:1).` });
    }
    if (!contains(poster, t.box, 2)) issues.push({ level: 'error', code: 'off-poster', key: t.key, message: `The ${label(t)} runs off the edge.` });
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (overlapArea(a.box, b.box) > 0.04 * Math.min(area(a.box), area(b.box))) {
        issues.push({ level: 'error', code: 'text-overlap', key: a.key, message: `The ${label(a)} and the ${label(b)} overlap.` });
      }
    }
  }

  // Badges sit on top of things; they must never cover words.
  for (const b of badges) {
    for (const t of texts) {
      if (overlapArea(b.box, t.box) > 0) issues.push({ level: 'error', code: 'badge-covers-text', key: t.key, message: `The badge covers the ${label(t)}.` });
    }
  }

  // Logos: size, edges, clear space.
  const primaryLogo = logos.find((l) => l.key === 'primary');
  if (!primaryLogo) issues.push({ level: 'error', code: 'no-logo', message: 'The main logo isn’t on the poster.' });
  for (const l of logos) {
    const brandLogo = kit.logos.find((b) => b.id === l.logoId);
    const minH = (brandLogo?.minHeight ?? 0.05) * short;
    if (l.box.h < minH - 0.5) issues.push({ level: 'error', code: 'logo-small', key: l.key, message: `The ${l.key === 'primary' ? 'main' : 'campaign'} logo is smaller than its minimum size.` });
    if (!contains(poster, l.box, 1)) issues.push({ level: 'error', code: 'logo-cut', key: l.key, message: 'A logo is cut off by the edge.' });
    const zone = l.clearSpace || 0;
    const crowding = [...texts, ...sponsors, ...badges, ...logos.filter((o) => o !== l)].filter((o) => intersects(l.box, o.box, zone - 0.5));
    for (const o of crowding) {
      issues.push({ level: 'error', code: 'clear-space', key: l.key, message: `The ${o.kind === 'logo' ? 'other logo' : o.kind === 'sponsor' ? 'sponsor logos' : label(o)} sits inside the logo’s clear space.` });
    }
    if (brandLogo?.requiresPrimary && !primaryLogo) issues.push({ level: 'error', code: 'campaign-alone', key: l.key, message: 'This campaign logo may only appear together with the club logo.' });
  }

  // Sponsors never outweigh the club logo, and every sponsor that was asked for is shown.
  if (primaryLogo?.visualArea) {
    const heavy = sponsors.filter((s) => (s.visualArea || 0) > primaryLogo.visualArea! * 0.82);
    if (heavy.length) issues.push({ level: 'error', code: 'sponsor-dominant', message: 'A sponsor logo looks bigger than the club logo.' });
  }
  if (doc.sponsors.length && sponsors.length < doc.sponsors.length) {
    issues.push({ level: 'error', code: 'sponsors-missing', message: `Only ${sponsors.length} of ${doc.sponsors.length} sponsor logos fit on this design.` });
  }
  for (const s of sponsors) {
    if (!contains(poster, s.box, 1)) issues.push({ level: 'error', code: 'sponsor-cut', key: s.key, message: 'A sponsor logo is cut off by the edge.' });
    if (s.box.h < 0.022 * short) issues.push({ level: 'warning', code: 'sponsor-small', key: s.key, message: 'A sponsor logo is very small.' });
    for (const t of texts) if (intersects(s.box, t.box)) issues.push({ level: 'error', code: 'sponsor-overlap', key: s.key, message: `A sponsor logo overlaps the ${label(t)}.` });
  }
  for (let i = 0; i < sponsors.length; i++) {
    for (let j = i + 1; j < sponsors.length; j++) {
      if (intersects(sponsors[i].box, sponsors[j].box, 2)) issues.push({ level: 'error', code: 'sponsor-collide', message: 'Two sponsor logos touch.' });
    }
  }

  // Content the design needs.
  for (const f of template.fields) {
    if (!f.required) continue;
    const v = (doc.text as any)[f.name];
    if (!v || (typeof v === 'string' && !v.trim())) issues.push({ level: 'warning', code: 'missing-text', message: `The ${FIELD_LABEL[f.name] || f.name} is empty.` });
  }
  if (doc.photos.length < template.photos.min) issues.push({ level: 'error', code: 'photo-missing', message: `This design needs ${template.photos.min} photo${template.photos.min === 1 ? '' : 's'}.` });
  if (doc.photos.some((p) => p.consent === false)) issues.push({ level: 'error', code: 'consent', message: 'A photo of people has no recorded consent.' });

  // One message per problem and place.
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}|${i.key || ''}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A simple score from the checks: 100 is clean; errors cost a lot, warnings a little. */
export function checkScore(issues: DesignIssue[]): number {
  return Math.max(0, 100 - issues.reduce((s, i) => s + (i.level === 'error' ? 30 : 6), 0));
}

export const hasErrors = (issues: DesignIssue[]) => issues.some((i) => i.level === 'error');

/** Where each editable thing sits on the poster (0..1 of its width and height), so the app can
 *  let people tap a line on the picture to change it. Detail lines are grouped as "details". */
export function editableAreas(report: RenderReport): { field: string; x: number; y: number; w: number; h: number }[] {
  const fields = new Set(['eyebrow', 'headline', 'subhead', 'body', 'cta', 'footnote', 'hashtag', 'sponsorsTitle', 'personLabel', 'personName', 'personRole', 'social', 'web']);
  const boxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  for (const el of report.elements) {
    let field: string | null = null;
    if (el.kind === 'badge') field = 'badge';
    else if (el.kind === 'text') {
      const f = el.field || el.key;
      if (fields.has(f)) field = f;
      else if (/^detail/.test(f) || /^detail/.test(el.key)) field = 'details';
    }
    if (!field || el.box.w <= 0 || el.box.h <= 0) continue;
    const b = boxes.get(field);
    const x1 = el.box.x + el.box.w;
    const y1 = el.box.y + el.box.h;
    boxes.set(field, b ? { x0: Math.min(b.x0, el.box.x), y0: Math.min(b.y0, el.box.y), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0: el.box.x, y0: el.box.y, x1, y1 });
  }
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return Array.from(boxes.entries()).map(([field, b]) => ({
    field,
    x: r(Math.max(0, b.x0 / report.width)),
    y: r(Math.max(0, b.y0 / report.height)),
    w: r(Math.min(1, (b.x1 - b.x0) / report.width)),
    h: r(Math.min(1, (b.y1 - b.y0) / report.height))
  }));
}
