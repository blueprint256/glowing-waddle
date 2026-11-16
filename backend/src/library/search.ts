/**
 * Ranking helpers for Library search (pure, unit-tested).
 * Keyword search uses MongoDB's text index; "search by meaning" uses embeddings when available.
 * The two ranked lists are merged with Reciprocal Rank Fusion.
 */
export function cosine(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function reciprocalRankFusion(lists: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Everything searchable about an item, in one string (feeds the text index and embeddings). */
export function buildSearchText(a: {
  title?: string;
  description?: string;
  textContent?: string;
  tags?: string[];
  event?: string;
  category?: string;
  originalName?: string;
  folder?: string;
  colors?: string[];
  notes?: string;
  links?: string[];
}): string {
  return [
    a.title,
    a.event,
    a.category?.replace('_', ' '),
    (a.tags || []).join(' '),
    a.description,
    a.notes,
    a.textContent,
    a.originalName,
    a.folder?.replace(/[\\/]/g, ' '),
    (a.colors || []).join(' '),
    (a.links || []).join(' ')
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 20000);
}

/** Text used for the embedding (meaning) of an item: compact and descriptive. */
export function embeddingText(a: { title?: string; event?: string; category?: string; description?: string; tags?: string[]; textContent?: string }): string {
  return [a.title, a.event, a.category, a.description, (a.tags || []).join(', '), (a.textContent || '').slice(0, 1500)]
    .filter(Boolean)
    .join('. ')
    .slice(0, 6000);
}
