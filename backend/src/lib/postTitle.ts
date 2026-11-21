/**
 * A post's title is only a label for calendar cards, so people don't have to type one: it's taken
 * from the start of the caption (or the brief), and they can rename it. Pure (tested in
 * scripts/postsSelfTest.ts).
 */

const MAX_WORDS = 7;
const MAX_CHARS = 60;

/** "🎉 Big news! Our cold brew is back this Friday… #coffee" → "Big news! Our cold brew is back" */
export function titleFrom(...texts: (string | null | undefined)[]): string {
  for (const raw of texts) {
    if (!raw || typeof raw !== 'string') continue;
    const firstLine = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.replace(/[#@][\p{L}\p{N}_]+/gu, '').replace(/[^\p{L}\p{N}]/gu, '').length > 0);
    if (!firstLine) continue;
    const words = firstLine
      .replace(/https?:\/\/\S+/g, ' ') // links
      .replace(/[#@][\p{L}\p{N}_]+/gu, ' ') // hashtags and mentions
      .replace(/\p{Extended_Pictographic}|️|‍/gu, ' ') // emoji
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (!words.length) continue;
    let title = words.slice(0, MAX_WORDS).join(' ');
    if (title.length > MAX_CHARS) title = title.slice(0, MAX_CHARS).replace(/\s+\S*$/, '');
    title = title.replace(/[\s,;:–—-]+$/u, '');
    if (title) return title;
  }
  return 'Untitled post';
}
