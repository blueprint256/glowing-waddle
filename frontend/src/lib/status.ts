/**
 * Every status people see, with one label and one colour each (styles/tokens.css --st-*).
 * Red only ever means a problem.
 *
 * Posts (API name: tasks) follow their life: Idea → Draft → Ready → Scheduled → Published, plus
 * Needs attention. People choose Idea, Draft, Ready and Published; Publishing sets Scheduled and
 * Needs attention (and Published when a post goes out). Older names from before Nov 2026
 * (Pending, In Progress, Completed) are read as Draft / Draft / Ready.
 */

export type PostStatus = 'Idea' | 'Draft' | 'Ready' | 'Scheduled' | 'Published' | 'Needs attention';

export const POST_STATUSES: PostStatus[] = ['Idea', 'Draft', 'Ready', 'Scheduled', 'Published', 'Needs attention'];

/** What a person can choose (Scheduled / Needs attention come from Publishing). */
export const SETTABLE_POST_STATUSES: PostStatus[] = ['Idea', 'Draft', 'Ready', 'Published'];

export interface StatusMeta {
  label: string;
  /** Short explanation for tooltips and menus. */
  hint: string;
  bg: string;
  fg: string;
  dot: string;
}

const tone = (key: string) => ({ bg: `var(--st-${key}-bg)`, fg: `var(--st-${key}-fg)`, dot: `var(--st-${key}-dot)` });

const POST_META: Record<PostStatus, StatusMeta> = {
  Idea: { label: 'Idea', hint: 'Just an idea for now', ...tone('idea') },
  Draft: { label: 'Draft', hint: 'Being written or designed', ...tone('draft') },
  Ready: { label: 'Ready', hint: 'Checked and ready to publish', ...tone('ready') },
  Scheduled: { label: 'Scheduled', hint: 'Waiting to go out (set by Publishing)', ...tone('scheduled') },
  Published: { label: 'Published', hint: 'Live on at least one platform', ...tone('published') },
  'Needs attention': { label: 'Needs attention', hint: 'Publishing failed or it’s time to post it by hand', ...tone('attention') }
};

const LEGACY: Record<string, PostStatus> = { pending: 'Draft', 'in progress': 'Draft', completed: 'Ready' };

/** Reads any spelling (and older names) as a post status; unknown values count as Draft. */
export function toPostStatus(value: unknown): PostStatus {
  if (typeof value !== 'string') return 'Draft';
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const found = POST_STATUSES.find((s) => s.toLowerCase() === key);
  return found || LEGACY[key] || 'Draft';
}

export function postStatusMeta(value: unknown): StatusMeta {
  return POST_META[toPostStatus(value)];
}

/** True when the status comes from Publishing and can't be changed by hand. */
export function isPublishingStatus(value: unknown): boolean {
  const s = toPostStatus(value);
  return s === 'Scheduled' || s === 'Needs attention';
}

// ---------------------------------------------------------------------------
// Campaigns, themes (API: projects) and publishing records
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = ['draft', 'planning', 'active', 'paused', 'completed'] as const;
export const THEME_STATUSES = ['planning', 'in_progress', 'review', 'completed', 'on_hold'] as const;

const CAMPAIGN_META: Record<string, StatusMeta> = {
  draft: { label: 'Draft', hint: 'Not started', ...tone('idea') },
  planning: { label: 'Planning', hint: 'Posts are being planned', ...tone('draft') },
  active: { label: 'Active', hint: 'Posts are going out', ...tone('published') },
  paused: { label: 'Paused', hint: 'On hold for now', ...tone('idea') },
  completed: { label: 'Finished', hint: 'All done', ...tone('ready') },
  archived: { label: 'Archived', hint: 'Hidden from lists; can be restored', ...tone('idea') }
};

const THEME_META: Record<string, StatusMeta> = {
  planning: { label: 'Planning', hint: '', ...tone('idea') },
  in_progress: { label: 'In progress', hint: '', ...tone('draft') },
  review: { label: 'Checking', hint: '', ...tone('ready') },
  completed: { label: 'Done', hint: '', ...tone('published') },
  on_hold: { label: 'On hold', hint: '', ...tone('idea') }
};

const PUBLISH_META: Record<string, StatusMeta> = {
  draft: { label: 'Draft', hint: 'Saved, not scheduled', ...tone('idea') },
  scheduled: { label: 'Scheduled', hint: 'Waiting to go out', ...tone('scheduled') },
  publishing: { label: 'Publishing', hint: 'Going out now', ...tone('scheduled') },
  processing: { label: 'Processing', hint: 'The platform is processing it', ...tone('scheduled') },
  published: { label: 'Published', hint: 'Live', ...tone('published') },
  failed: { label: 'Failed', hint: 'Didn’t go out; retry or fix it', ...tone('attention') },
  due: { label: 'Post by hand', hint: 'Time to post it yourself', ...tone('attention') },
  cancelled: { label: 'Cancelled', hint: 'Won’t go out', ...tone('idea') }
};

const fallback = (value: unknown): StatusMeta => {
  const label = String(value || '').replace(/_/g, ' ');
  return { label: label.charAt(0).toUpperCase() + label.slice(1), hint: '', ...tone('idea') };
};

export const campaignStatusMeta = (value: unknown): StatusMeta => CAMPAIGN_META[String(value)] || fallback(value);
export const themeStatusMeta = (value: unknown): StatusMeta => THEME_META[String(value)] || fallback(value);
export const publishStatusMeta = (value: unknown): StatusMeta => PUBLISH_META[String(value)] || fallback(value);
