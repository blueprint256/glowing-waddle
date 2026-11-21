import { MONTH_NAMES } from './dates';

/**
 * The Library's "table of contents": years → months → events, with counts.
 * Small enough for an AI to read first, so it knows exactly where to look before searching.
 */
export interface OverviewRow {
  year: number;
  month: number; // 1-12
  count: number;
  kinds: Record<string, number>;
  events: Record<string, number>;
}

export interface LibraryOverview {
  total: number;
  kinds: Record<string, number>;
  years: {
    year: number;
    count: number;
    months: { month: number; name: string; count: number; kinds: Record<string, number>; events: { name: string; count: number }[] }[];
  }[];
  topEvents: { name: string; count: number }[];
}

export function buildOverview(rows: OverviewRow[], maxEventsPerMonth = 5): LibraryOverview {
  const kinds: Record<string, number> = {};
  const allEvents: Record<string, number> = {};
  const byYear = new Map<number, LibraryOverview['years'][number]>();
  let total = 0;

  for (const r of rows) {
    total += r.count;
    for (const [k, n] of Object.entries(r.kinds)) kinds[k] = (kinds[k] || 0) + n;
    for (const [e, n] of Object.entries(r.events)) allEvents[e] = (allEvents[e] || 0) + n;
    let y = byYear.get(r.year);
    if (!y) {
      y = { year: r.year, count: 0, months: [] };
      byYear.set(r.year, y);
    }
    y.count += r.count;
    y.months.push({
      month: r.month,
      name: MONTH_NAMES[r.month - 1],
      count: r.count,
      kinds: r.kinds,
      events: Object.entries(r.events)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, maxEventsPerMonth)
    });
  }

  const years = [...byYear.values()].sort((a, b) => b.year - a.year);
  years.forEach((y) => y.months.sort((a, b) => b.month - a.month));
  const topEvents = Object.entries(allEvents)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { total, kinds, years, topEvents };
}
