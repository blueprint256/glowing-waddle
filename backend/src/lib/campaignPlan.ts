import { normalizePostStatus, TaskStatus } from './postStatus';
import { AIError } from './aiError';

/**
 * Plan with AI, the pure parts (no database): the built-in prompt, reading the AI's reply, cleaning
 * the draft, and checking a reviewed draft. services/campaignPlan.ts runs the AI and saves.
 */

type CampaignDates = { startDate?: Date | null; endDate?: Date | null };

export const PLAN_COMMAND = 'generate-campaign';
export const PLAN_LIMITS = { themes: 12, postsPerTheme: 40, posts: 120, notes: 2000 };

export interface PlanPost {
  name: string;
  brief: string;
  caption: string;
  /** "2026-11-20", or null when the AI gave no usable day. */
  day: string | null;
  status: 'Idea' | 'Draft' | 'Ready';
}

export interface PlanTheme {
  name: string;
  description: string;
  startDate: string | null;
  dueDate: string | null;
  /** Set when the posts go into a theme that already exists. */
  existingId?: string | null;
  posts: PlanPost[];
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

export const BUILTIN_PLAN_CAMPAIGN = `You are a senior social media strategist planning posts for this brand.

Brand:
{brand}

Campaign:
{campaign}

What to plan:
{instruction}

Group the posts into a few themes (a theme is a strand of the campaign, such as "Launch week", "Behind the scenes" or "Customer stories"). For every post give a short title, a brief (the goal, the key message and the visual idea, 30 to 70 words) and a finished caption in the brand's tone.

Rules:
- Follow the brand's tone of voice and its rules.
- Do not invent prices, discounts, dates of events, names or links that are not given above.
- Spread the posts sensibly over the period; avoid two posts of the same theme on the same day.
- Reply with JSON only, no explanation, in exactly this shape:
[
  {
    "projectName": "Theme name",
    "projectDescription": "One sentence on what this theme is about",
    "startDate": "YYYY-MM-DD",
    "dueDate": "YYYY-MM-DD",
    "tasks": [
      { "taskName": "Post title", "taskDescription": "Brief", "content": "Caption", "taskDate": "YYYY-MM-DD" }
    ]
  }
]`;

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

/** Finds the JSON array in an AI reply (code fences, a sentence around it, or {"projects": [...]}). */
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
  if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') parsed = parsed.projects || parsed.themes || parsed.plan;
  if (!Array.isArray(parsed)) throw new AIError(502, 'The AI’s answer wasn’t a plan. Try again.');
  return parsed;
}

/** Turns whatever the AI wrote into a clean draft (names, limits, days, statuses). */
export function normalizePlan(raw: any[]): PlanTheme[] {
  const themes: PlanTheme[] = [];
  let total = 0;
  for (const t of raw) {
    if (!t || typeof t !== 'object' || themes.length >= PLAN_LIMITS.themes) continue;
    const name = text(t.projectName ?? t.themeName ?? t.name ?? t.theme, 120);
    if (!name) continue;
    const posts: PlanPost[] = [];
    const list = Array.isArray(t.tasks) ? t.tasks : Array.isArray(t.posts) ? t.posts : [];
    for (const p of list) {
      if (!p || typeof p !== 'object' || posts.length >= PLAN_LIMITS.postsPerTheme || total >= PLAN_LIMITS.posts) continue;
      const title = text(p.taskName ?? p.postTitle ?? p.title ?? p.name, 200);
      if (!title) continue;
      const s = normalizePostStatus(p.status);
      posts.push({
        name: title,
        brief: text(p.taskDescription ?? p.brief ?? p.description, 4000),
        caption: text(p.content ?? p.caption, 5000),
        day: planDay(p.taskDate ?? p.date ?? p.day),
        status: s === TaskStatus.IDEA ? 'Idea' : s === TaskStatus.READY ? 'Ready' : 'Draft'
      });
      total++;
    }
    themes.push({
      name,
      description: text(t.projectDescription ?? t.description, 1000),
      startDate: planDay(t.startDate),
      dueDate: planDay(t.dueDate ?? t.endDate),
      posts
    });
  }
  return themes;
}

/** Checks a reviewed draft sent back by the app (it may have been edited). */
export function validatePlan(input: unknown): PlanTheme[] {
  if (!Array.isArray(input)) throw new AIError(400, 'Nothing to create.');
  const themes = normalizePlan(
    input.map((t: any) => ({
      projectName: t?.name,
      projectDescription: t?.description,
      startDate: t?.startDate,
      dueDate: t?.dueDate,
      tasks: Array.isArray(t?.posts) ? t.posts.map((p: any) => ({ taskName: p?.name, taskDescription: p?.brief, content: p?.caption, taskDate: p?.day, status: p?.status })) : []
    }))
  );
  // normalizePlan drops nameless entries, so match the existing ids by position of what was kept.
  const kept = input.filter((t: any) => typeof t?.name === 'string' && t.name.trim());
  themes.forEach((t, i) => {
    const id = kept[i]?.existingId;
    t.existingId = typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) ? id : null;
  });
  if (!themes.some((t) => t.posts.length)) throw new AIError(400, 'Choose at least one post to create.');
  return themes;
}

