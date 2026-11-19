import { normalizePostStatus, TaskStatus } from './postStatus';
import { AIError } from './aiError';

/**
 * Plan with AI, the pure parts (no database): the built-in prompt, reading the AI's reply, cleaning
 * the draft, and checking a reviewed draft. services/campaignPlan.ts runs the AI and saves.
 */

type CampaignDates = { startDate?: Date | null; endDate?: Date | null };

export const PLAN_COMMAND = 'generate-campaign';
export const PLAN_LIMITS = { posts: 120, notes: 2000 };

export interface PlanPost {
  name: string;
  brief: string;
  caption: string;
  /** "2026-11-20", or null when the AI gave no usable day. */
  day: string | null;
  status: 'Idea' | 'Draft' | 'Ready';
}

export interface PlanOptions {
  /** What the person wants ("launch week, then two posts a week about the new menu"). */
  notes?: string;
  /** Period to plan, "YYYY-MM-DD" (defaults: the campaign's dates, else the next 4 weeks). */
  from?: string;
  to?: string;
  /** Rough number of posts per week (1–14). */
  perWeek?: number;
  /** Admin command to run instead of the default. */
  command?: string;
}

/**
 * How each planned post's picture is described, so the poster engine can lay it out straight away.
 * Sent with every plan (the built-in prompt, and an admin's prompt through {instruction}).
 */
export const PICTURE_RULES = `Pictures:
- "picture.kind" is "poster" for posts with a message, an event, a date, figures or partners (most posts), or "photo" for a picture with no words (a mood, a product, behind the scenes).
- For a poster, "picture.facts" holds only facts given above, copied exactly: a short headline idea (at most 8 words), and when there is one, the date, time and place, and any figures ("2,000 trees planted"). Leave out anything not given; never invent dates, places, names or numbers.

Reply with JSON only, no explanation, in exactly this shape:
[
  { "title": "Post title", "brief": "What the post is about", "caption": "Caption", "day": "YYYY-MM-DD", "picture": { "kind": "poster", "facts": { "headline": "…", "date": "…", "time": "…", "place": "…", "figures": ["…"] } } }
]`;

export const BUILTIN_PLAN_CAMPAIGN = `You are a senior social media strategist planning posts for this brand.

Brand:
{brand}

Campaign:
{campaign}

What to plan:
{instruction}

For every post give a short title (3 to 6 words), a brief (what the post is about: the goal, the key message and the picture idea, 30 to 70 words), a finished caption in the brand's tone, and the picture it needs.

Rules:
- Follow the brand's tone of voice and its rules.
- Do not invent prices, discounts, dates of events, names or links that are not given above.
- Spread the posts sensibly over the period and vary them (announcements, tips, behind the scenes, customer stories…); at most one post a day unless asked.
${PICTURE_RULES}`;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Reads a day the AI wrote ("2026-11-20", "2026-11-20T09:00:00Z"); anything else → null. */
export function planDay(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (isDay(s.slice(0, 10))) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : ymd(d);
}

/**
 * The picture a plan gave a post, written into its brief so people can read and edit it, and the
 * poster engine reads it as the poster's facts.
 */
export function pictureLines(picture: unknown): string {
  if (!picture || typeof picture !== 'object') return '';
  const p = picture as any;
  const kind = String(p.kind || p.type || '').toLowerCase();
  if (kind === 'photo') return 'Picture: a photo with no words.';
  const f = p.facts && typeof p.facts === 'object' ? p.facts : p;
  const one = (v: unknown, max = 160) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
  const figures = Array.isArray(f.figures) ? f.figures.map((x: unknown) => one(x, 80)).filter(Boolean).slice(0, 3) : [];
  const lines = [
    one(f.headline) && `Headline idea: ${one(f.headline)}`,
    one(f.date) && `Date: ${one(f.date)}`,
    one(f.time) && `Time: ${one(f.time)}`,
    one(f.place ?? f.venue) && `Place: ${one(f.place ?? f.venue)}`,
    figures.length ? `Figures: ${figures.join('; ')}` : ''
  ].filter(Boolean);
  if (kind !== 'poster' && !lines.length) return '';
  return ['Poster facts:', ...lines.map((l) => `- ${l}`)].join('\n');
}

const text = (v: unknown, max: number): string => {
  if (typeof v === 'string') return v.trim().slice(0, max);
  if (v && typeof v === 'object') return JSON.stringify(v).slice(0, max);
  return '';
};

/** The period to plan: what was asked, else the campaign's dates, else the next 4 weeks. */
export function planWindow(campaign: CampaignDates, opts: PlanOptions, now = new Date()): { from: string; to: string } {
  const today = ymd(now);
  let from = isDay(opts.from) ? opts.from : campaign.startDate ? ymd(new Date(campaign.startDate)) : today;
  if (!isDay(opts.from) && from < today) from = today; // don't plan into the past by default
  let to = isDay(opts.to) ? opts.to : campaign.endDate ? ymd(new Date(campaign.endDate)) : '';
  if (!to || to < from) to = ymd(new Date(Date.parse(`${from}T00:00:00Z`) + 27 * 86400000));
  return { from, to };
}

/** Finds the JSON array in an AI reply (code fences, a sentence around it, or {"posts": [...]}). */
export function parsePlanReply(content: string): any[] {
  const raw = String(content || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start === -1 || end <= start) throw new AIError(502, 'The AI’s answer wasn’t a plan. Try again.');
    try {
      parsed = JSON.parse(body.slice(start, end + 1));
    } catch {
      throw new AIError(502, 'The AI’s answer was cut off or malformed. Try again, or plan a shorter period.');
    }
  }
  if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') parsed = parsed.posts || parsed.tasks || parsed.projects || parsed.themes || parsed.plan;
  if (!Array.isArray(parsed)) throw new AIError(502, 'The AI’s answer wasn’t a plan. Try again.');
  return parsed;
}

/**
 * Turns whatever the AI wrote into a clean list of posts (titles, limits, days, statuses). Older
 * prompts that group posts into themes ([{ projectName, tasks: [...] }]) are read too: the groups
 * are flattened, since themes were retired.
 */
export function normalizePlan(raw: any[]): PlanPost[] {
  const entries: any[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const group = Array.isArray(item.tasks) ? item.tasks : Array.isArray(item.posts) ? item.posts : null;
    if (group) entries.push(...group);
    else entries.push(item);
  }
  const posts: PlanPost[] = [];
  for (const p of entries) {
    if (!p || typeof p !== 'object' || posts.length >= PLAN_LIMITS.posts) continue;
    const title = text(p.title ?? p.taskName ?? p.postTitle ?? p.name, 200);
    const caption = text(p.caption ?? p.content, 5000);
    const facts = pictureLines(p.picture ?? p.visual ?? p.poster);
    const said = text(p.brief ?? p.taskDescription ?? p.description, 4000);
    const brief = facts && !said.includes(facts) ? `${said}\n\n${facts}`.trim().slice(0, 4000) : said;
    if (!title && !caption && !brief) continue;
    const s = normalizePostStatus(p.status);
    posts.push({
      name: title,
      brief,
      caption,
      day: planDay(p.day ?? p.taskDate ?? p.date),
      status: s === TaskStatus.IDEA ? 'Idea' : s === TaskStatus.READY ? 'Ready' : 'Draft'
    });
  }
  return posts.sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999'));
}

/**
 * Checks a reviewed list sent back by the app (it may have been edited): { posts: [...] }, or the
 * older { themes: [{ posts: [...] }] }.
 */
export function validatePlan(input: { posts?: unknown; themes?: unknown }): PlanPost[] {
  const list = Array.isArray(input?.posts) ? input.posts : Array.isArray(input?.themes) ? input.themes : null;
  if (!list) throw new AIError(400, 'Nothing to create.');
  const posts = normalizePlan(list);
  if (!posts.length) throw new AIError(400, 'Choose at least one post to create.');
  return posts;
}
