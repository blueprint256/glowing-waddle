/**
 * Monthly AI allowance, the pure rules (decision 20): each client account gets a number of AI
 * pictures and Blue messages per calendar month (UTC). Admins have no limit. A limit of 0 means no
 * limit. One AI picture is one designed poster (counted once however many options, edits and
 * re-renders it gets), one AI photo, or one change to a photo. "designs" is the older separate
 * poster allowance: it now counts against the same pictures allowance.
 */

export const DEFAULT_ALLOWANCE = { images: 30, designs: 30, blueMessages: 300 };

export type AllowanceKind = 'images' | 'designs' | 'blueMessages';

/** First moment of this month and of the next (UTC). */
export function monthWindow(now = new Date()): { start: Date; resetsAt: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, resetsAt };
}

/** The account's own limit when set (a whole number ≥ 0), else the workspace default. */
export function effectiveLimit(own: unknown, workspaceDefault: unknown, fallback: number): number {
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (valid(own)) return own;
  if (valid(workspaceDefault)) return workspaceDefault;
  return fallback;
}

/** Left this month (null = no limit). */
export function remainingOf(limit: number, used: number): number | null {
  return limit === 0 ? null : Math.max(0, limit - used);
}

/** "1 December" */
export function resetLabel(resetsAt: Date): string {
  return resetsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function limitMessage(kind: AllowanceKind, limit: number, resetsAt: Date): string {
  const what = kind === 'blueMessages' ? `Blue message${limit === 1 ? '' : 's'}` : `AI picture${limit === 1 ? '' : 's'} (posters and photos)`;
  return `You’ve used all ${limit} ${what} for this month. They renew on ${resetLabel(resetsAt)}. Ask the Blueprint team (Inbox → Message support) if you need more.`;
}
