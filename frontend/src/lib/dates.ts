/**
 * One way of writing dates across the app, in the person's own language settings.
 *
 * Two kinds of dates:
 * - Post days (task dates) are calendar days, stored as midnight UTC ("2026-11-20T00:00:00Z").
 *   They are always read and written in UTC so a post never jumps to the day before/after.
 * - Moments (publishing times, "updated at") are real instants shown in the person's time zone.
 */

type DateLike = string | number | Date | null | undefined;

const toDate = (value: DateLike): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Post days (UTC calendar days)
// ---------------------------------------------------------------------------

/** "2026-11-20" for a post day, or null. */
export function dayKey(value: DateLike): string | null {
  const d = toDate(value);
  if (!d) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "2026-11-20" for today in the person's own time zone. */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The value to save for a post day ("2026-11-20" → "2026-11-20T00:00:00.000Z"). */
export function dayToISO(key: string): string {
  return `${key}T00:00:00.000Z`;
}

/** A UTC Date for a day key (for arithmetic). */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function addDays(key: string, days: number): string {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dayKey(d)!;
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToDate(b).getTime() - keyToDate(a).getTime()) / 86_400_000);
}

const sameYear = (d: Date, utc: boolean) => (utc ? d.getUTCFullYear() : d.getFullYear()) === new Date().getFullYear();

/** "Fri, 20 Nov" (plus the year when it isn't this year). Optionally "Today" / "Tomorrow" / "Yesterday". */
export function formatDay(value: DateLike, opts: { relative?: boolean; weekday?: boolean } = {}): string {
  const d = toDate(value);
  if (!d) return '';
  if (opts.relative) {
    const diff = daysBetween(todayKey(), dayKey(d)!);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
  }
  return d.toLocaleDateString(undefined, {
    ...(opts.weekday === false ? {} : { weekday: 'short' }),
    day: 'numeric',
    month: 'short',
    ...(sameYear(d, true) ? {} : { year: 'numeric' }),
    timeZone: 'UTC'
  });
}

/** "20 – 25 Nov 2026", "28 Nov – 3 Dec 2026". */
export function formatDayRange(start: DateLike, end: DateLike): string {
  const a = toDate(start);
  const b = toDate(end);
  if (!a && !b) return '';
  if (!a || !b) return formatDay(a || b, { weekday: false });
  const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' } as const;
  const year = b.getUTCFullYear();
  const left = a.toLocaleDateString(undefined, a.getUTCFullYear() === year ? opts : { ...opts, year: 'numeric' });
  const right = b.toLocaleDateString(undefined, { ...opts, year: 'numeric' });
  return `${left} – ${right}`;
}

/** "November 2026". */
export function formatMonth(key: string): string {
  return keyToDate(key).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Moments (person's time zone)
// ---------------------------------------------------------------------------

/** "09:30". */
export function formatTime(value: DateLike): string {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
}

/** "Fri, 20 Nov · 09:30" (with the year when it isn't this year). */
export function formatDateTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return '';
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear(d, false) ? {} : { year: 'numeric' }) });
  return `${date} · ${formatTime(d)}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then the date. */
export function formatAgo(value: DateLike, now = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172_800) return 'yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear(d, false) ? {} : { year: 'numeric' }) });
}

/** The person's time zone name, e.g. "Africa/Kampala". */
export function timeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
