import { parseDay } from './dates';
import { mergeTags } from './search';

/**
 * The AI "understanding" step: what we ask a vision model about each file, and how we read its answer.
 */
export const CATEGORIES = [
  'poster', 'social_post', 'photo', 'logo', 'illustration', 'screenshot', 'document', 'caption', 'draft', 'video', 'other'
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Analysis {
  title: string;
  category: Category;
  description: string;
  textInImage: string;
  tags: string[];
  event: string;
  contentDate: Date | null;
  colors: string[];
  language: string;
}

export function buildAnalysisPrompt(input: {
  fileName: string;
  folder?: string;
  kind: string;
  mime: string;
  knownDate?: string | null;
  extractedText?: string;
  companyName?: string;
  hasImage: boolean;
}): string {
  const text = (input.extractedText || '').slice(0, 8000);
  return `You are cataloguing a marketing team's archive so it can be searched later.${input.companyName ? ` The team works for ${input.companyName}.` : ''}
Describe this item for a search index. Be factual: only describe what you can see or read.

File name: ${input.fileName}
${input.folder ? `Folder: ${input.folder}\n` : ''}File type: ${input.kind} (${input.mime})
${input.knownDate ? `Known date: ${input.knownDate}\n` : ''}${input.hasImage ? 'The image is attached.\n' : 'No image is attached; work from the file name and text.\n'}${text ? `\nText content (may be truncated):\n"""\n${text}\n"""\n` : ''}
Reply with ONLY a JSON object, no other text:
{
  "title": "short human title, max 80 characters",
  "category": one of ${CATEGORIES.map((c) => `"${c}"`).join(', ')},
  "description": "2-3 sentences: what it shows or says, style, likely purpose",
  "text_in_image": "the main readable text, verbatim, max 1500 characters, or empty",
  "tags": ["up to 12 short lowercase tags: subjects, products, people types, places, style"],
  "event": "the occasion or campaign it relates to, e.g. \\"Women's Day\\", \\"Black Friday\\", \\"Christmas\\", or empty",
  "content_date": "YYYY-MM-DD only if a specific date is clearly shown or stated, else empty",
  "colors": ["up to 5 dominant colour names"],
  "language": "main language of any text, or empty"
}`;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function list(v: unknown, maxItems: number, maxLen: number, lower = false): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    let s = str(item, maxLen);
    if (lower) s = s.toLowerCase();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Tolerates code fences and prose around the JSON. Returns null when no JSON object can be read. */
export function parseAnalysis(raw: string): Analysis | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let json: any;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const category = CATEGORIES.includes(json.category) ? (json.category as Category) : 'other';
  return {
    title: str(json.title, 80),
    category,
    description: str(json.description, 600),
    textInImage: typeof json.text_in_image === 'string' ? json.text_in_image.trim().slice(0, 1500) : '',
    tags: mergeTags([Array.isArray(json.tags) ? json.tags.filter((t: unknown) => typeof t === 'string') : []], 12),
    event: str(json.event, 80),
    contentDate: parseDay(json.content_date),
    colors: list(json.colors, 5, 30, true),
    language: str(json.language, 40)
  };
}
