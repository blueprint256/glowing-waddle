/**
 * The critic: after the code checks pass, Claude looks at the rendered options side by side and
 * ranks them as a senior designer would (it compares; it doesn't score in a vacuum). It can reject
 * an option the checks can't see, such as a crop through a face or an awkward composition.
 */

export const CRITIC_TOOL = {
  name: 'submit_ranking',
  description: 'Rank the poster options from best to worst.',
  schema: {
    type: 'object',
    required: ['ranking'],
    properties: {
      ranking: {
        type: 'array',
        items: {
          type: 'object',
          required: ['option', 'score', 'reject'],
          properties: {
            option: { type: 'integer', description: 'The option number as shown.' },
            score: { type: 'number', description: '0–10: how close to finished agency work.' },
            reject: { type: 'boolean', description: 'True only if it must not be shown (e.g. a face or head cut off, words over a face, a broken layout).' },
            note: { type: 'string', description: 'One short sentence a designer would say about it.' }
          }
        }
      }
    }
  }
};

export const CRITIC_SYSTEM = `You are the creative director of a design studio, reviewing poster options before the client sees them. Look at them side by side and rank them.

Judge, in this order:
1. Does it work at a glance: one clear focal point, the headline read first, then the details?
2. Craft: balanced spacing and alignment, a crop that keeps people's faces and heads whole, type that sits well, nothing cramped or floating.
3. Does it feel designed rather than assembled: photo, colour and type working together.
4. Brand: logos clean and respected, colours on brand.
5. Fit for the message and audience.

Reject an option only if it would embarrass the client: a face or head cut off by a crop or covered by words or a badge, a broken layout, or something unreadable. Be decisive and brief. Return the ranking with the submit_ranking tool, best first.`;

export interface CriticRanking {
  ranking: { option: number; score: number; reject: boolean; note?: string }[];
}

/** Puts options in the critic's order; options it didn't mention keep their place at the end. */
export function applyRanking<T>(options: T[], ranking: CriticRanking | null): { item: T; score?: number; reject?: boolean; note?: string }[] {
  if (!ranking?.ranking?.length) return options.map((item) => ({ item }));
  const seen = new Set<number>();
  const out: { item: T; score?: number; reject?: boolean; note?: string }[] = [];
  for (const r of [...ranking.ranking].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    const i = Number(r.option) - 1;
    if (i < 0 || i >= options.length || seen.has(i)) continue;
    seen.add(i);
    out.push({ item: options[i], score: r.score, reject: !!r.reject, note: typeof r.note === 'string' ? r.note.slice(0, 200) : undefined });
  }
  options.forEach((item, i) => {
    if (!seen.has(i)) out.push({ item });
  });
  return out;
}
