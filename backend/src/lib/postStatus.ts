/**
 * A post's life (people see "post"; the code and API keep the name "task"):
 * Idea → Draft → Ready → Scheduled → Published, plus Needs attention when publishing fails or a
 * post is due by hand.
 *
 * - People choose Idea, Draft, Ready, and Published (for posts made by hand).
 * - Scheduled, Published and Needs attention also follow the post's publishing records
 *   automatically (services/postStatus.ts), so the planner can never say "Scheduled" for a post
 *   that isn't, or miss one that failed.
 * - Older values (Pending, In Progress, Completed) are still accepted everywhere and translated.
 *
 * Pure rules only (no database), so they can be unit-tested anywhere.
 */
export enum TaskStatus {
  IDEA = 'Idea',
  DRAFT = 'Draft',
  READY = 'Ready',
  SCHEDULED = 'Scheduled',
  PUBLISHED = 'Published',
  NEEDS_ATTENTION = 'Needs attention'
}

/** What a person may set directly. */
export const USER_SETTABLE_STATUSES: TaskStatus[] = [TaskStatus.IDEA, TaskStatus.DRAFT, TaskStatus.READY, TaskStatus.PUBLISHED];

/** Older names (app versions before Nov 2026, saved prompts, connector clients). */
export const LEGACY_STATUSES: Record<string, TaskStatus> = {
  pending: TaskStatus.DRAFT,
  'in progress': TaskStatus.DRAFT,
  completed: TaskStatus.READY
};

/** Every value the API accepts as input (new names and the older ones). */
export const ACCEPTED_STATUS_VALUES: string[] = [...Object.values(TaskStatus), 'Pending', 'In Progress', 'Completed'];

/**
 * Reads a status from any spelling people or the AI use ("needs_attention", "in-progress",
 * "COMPLETED", "ready"); null when it isn't a status.
 */
export function normalizePostStatus(value: unknown): TaskStatus | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!key) return null;
  const current = Object.values(TaskStatus).find((s) => s.toLowerCase() === key);
  if (current) return current;
  if (key === 'inprogress') return TaskStatus.DRAFT;
  if (key === 'attention' || key === 'failed') return TaskStatus.NEEDS_ATTENTION;
  if (key === 'done' || key === 'posted' || key === 'live') return TaskStatus.PUBLISHED;
  if (key === 'todo' || key === 'to do' || key === 'planned') return TaskStatus.IDEA;
  return LEGACY_STATUSES[key] ?? null;
}

/** Publishing record states that mean "waiting to go out / going out" and "needs fixing". */
export const ACTIVE_POST_STATES = ['scheduled', 'publishing', 'processing'];
export const ATTENTION_POST_STATES = ['failed', 'due'];

/** The status a post's publishing records call for, or null when it has none in play. */
export function statusFromPublishing(postStatuses: string[]): TaskStatus | null {
  const live = postStatuses.filter((s) => s !== 'draft' && s !== 'cancelled');
  if (live.some((s) => ATTENTION_POST_STATES.includes(s))) return TaskStatus.NEEDS_ATTENTION;
  if (live.some((s) => ACTIVE_POST_STATES.includes(s))) return TaskStatus.SCHEDULED;
  if (live.some((s) => s === 'published')) return TaskStatus.PUBLISHED;
  return null;
}
