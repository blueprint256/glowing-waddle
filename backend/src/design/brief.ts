import type { BrandKit, DesignText, DetailLine } from './types';
import { packById } from './packs';

/**
 * The words around a poster: the brand as the AI reads it, the brand's own voice, and the facts a
 * brief spells out (for the poster made without AI).
 */

export interface BrandVoice {
  about?: string;
  sector?: string;
  tone?: string;
  audience?: string;
  rules?: string;
  guidelines?: string;
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

/** The brand's own words about itself, for the copy (empty when nothing is set). */
export function voiceText(v: BrandVoice | null | undefined): string {
  if (!v) return '';
  const lines = [
    v.about && `What the brand does: ${v.about}`,
    v.sector && `Sector: ${v.sector}`,
    v.tone && `Tone of voice: ${v.tone}`,
    v.audience && `Audience: ${v.audience}`,
    v.rules && `Always and never (follow these in every word): ${v.rules}`,
    v.guidelines && `Brand guidelines: ${v.guidelines}`
  ].filter(Boolean);
  return lines.length ? `\nAbout the brand:\n${lines.join('\n')}` : '';
}

/**
 * The facts a brief spells out: "Date: …", "Place: …" lines, and labels inside prose ("… Call to
 * action: Volunteer with us. Photo: our volunteers."): the call to action is kept for the button;
 * notes about the picture never reach the poster.
 */
export function factsInBrief(brief: string): { text: string; headline?: string; date?: string; time?: string; place?: string; cta?: string; figures: string[] } {
  const out: { text: string; headline?: string; date?: string; time?: string; place?: string; cta?: string; figures: string[] } = { text: '', figures: [] };
  const kept: string[] = [];
  for (const raw of brief.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-•*]\s*/, '').trim();
    if (/^(poster facts|picture)\s*:/i.test(line)) continue;
    const m = line.match(/^(headline idea|headline|date|when|time|place|where|venue|figures?)\s*:\s*(.+)$/i);
    if (!m) {
      kept.push(raw);
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key.startsWith('headline')) out.headline = value;
    else if (key === 'date' || key === 'when') out.date = value;
    else if (key === 'time') out.time = value;
    else if (key === 'place' || key === 'where' || key === 'venue') out.place = value;
    else out.figures.push(...value.split(/\s*;\s*/).filter(Boolean));
  }
  const prose = kept.join(' ').replace(/\s+/g, ' ').trim();
  out.text = prose
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const m = sentence.match(/^(call to action|cta|photo|picture|picture idea|image)\s*:\s*(.+?)[.!]?$/i);
      if (!m) return true;
      if (/^(call to action|cta)$/i.test(m[1])) out.cta = m[2].trim();
      return false;
    })
    .join(' ');
  return out;
}

/** Words for a poster made without AI: the brief's facts, its first sentence as the headline. */
export function copyWithoutAI(brief: string, campaignName?: string): DesignText {
  const facts = factsInBrief(brief);
  const sentences = facts.text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let headline = facts.headline || sentences[0] || campaignName || 'Join us';
  // A long first sentence: up to its colon, or its first words.
  if (headline.length > 60) headline = headline.includes(':') && headline.indexOf(':') < 50 ? headline.slice(0, headline.indexOf(':')) : headline.split(' ').slice(0, 7).join(' ');
  const rest = facts.headline ? sentences : sentences.slice(1);
  const details: DetailLine[] = [];
  if (facts.date) details.push({ kind: 'date', text: facts.date });
  if (facts.time) details.push({ kind: 'time', text: facts.time });
  if (facts.place) details.push({ kind: 'place', text: facts.place });
  const copy: DesignText = { headline: headline.replace(/[.!:]+$/, '') };
  // Sentences that only repeat the date, time or place (already in the details) are left out.
  const known = [facts.date, facts.time, facts.place].filter(Boolean).map((f) => f!.toLowerCase().slice(0, 12));
  const repeats = (t: string) => /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(t) || known.some((k) => t.toLowerCase().includes(k));
  const subhead = rest.filter((t) => !repeats(t)).join(' ').slice(0, 160);
  if (subhead) copy.subhead = subhead;
  if (campaignName) copy.eyebrow = campaignName;
  if (details.length) copy.details = details;
  if (facts.cta) copy.cta = facts.cta;
  return copy;
}
