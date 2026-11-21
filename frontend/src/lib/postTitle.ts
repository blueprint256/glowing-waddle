/**
 * A post's automatic title: the start of the caption (or of "What's this post about?" while there's
 * no caption). Same rules as the server (backend/src/lib/postTitle.ts), so the title shown while
 * typing is the one that gets saved.
 */

const MAX_WORDS = 7;
const MAX_CHARS = 60;

export function titleFrom(...texts: (string | null | undefined)[]): string {
  for (const raw of texts) {
    if (!raw || typeof raw !== 'string') continue;
    const firstLine = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.replace(/[#@][\p{L}\p{N}_]+/gu, '').replace(/[^\p{L}\p{N}]/gu, '').length > 0);
    if (!firstLine) continue;
    const words = firstLine
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#@][\p{L}\p{N}_]+/gu, ' ')
      .replace(/\p{Extended_Pictographic}|️|‍/gu, ' ')
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
