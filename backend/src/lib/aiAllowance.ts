/**
 * Monthly AI allowance, the pure rules (decision 20): each client account gets a number of AI images
 * and Blue messages per calendar month (UTC). Admins have no limit. A limit of 0 means no limit.
 */

export const DEFAULT_ALLOWANCE = { images: 20, blueMessages: 300 };

export type AllowanceKind = 'images' | 'blueMessages';

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
  const what = kind === 'images' ? `AI image${limit === 1 ? '' : 's'}` : `Blue message${limit === 1 ? '' : 's'}`;
  return `You’ve used all ${limit} ${what} for this month. They renew on ${resetLabel(resetsAt)}. Ask the Blueprint team (Inbox → Message support) if you need more.`;
}
