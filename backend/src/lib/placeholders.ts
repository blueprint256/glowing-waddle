/**
 * The {placeholders} a prompt can use: one catalog for the prompt compiler, the "unknown
 * placeholder" check, the connector and the prompt editor's picker.
 *
 * New names follow what people see in the app (post, brief, caption, brand). The older names
 * ({taskDescription}, {companyInfo} …) keep working: each new name is an alias of one older name.
 * Pure (no database), so it can be tested anywhere.
 */

export interface PlaceholderInfo {
  /** Name written in prompts, without braces. */
  name: string;
  /** The older name this one stands for (the compiler fills that one). */
  aliasOf?: string;
  /** What it becomes. */
  description: string;
  group: 'Brand' | 'Campaign' | 'Post' | 'Images' | 'Steps';
  /** Older name still accepted but no longer suggested. */
  legacy?: boolean;
}

export const PLACEHOLDERS: PlaceholderInfo[] = [
  // Brand
  { name: 'brand', aliasOf: 'companyInfo', group: 'Brand', description: 'Everything in the brand profile (name, about, products, tone, audience, rules, guidelines)' },
  { name: 'brandName', aliasOf: 'companyName', group: 'Brand', description: 'The brand’s name' },
  { name: 'sector', group: 'Brand', description: 'The brand’s industry' },
  { name: 'brandTone', group: 'Brand', description: 'How the brand sounds' },
  { name: 'brandGuidelines', group: 'Brand', description: 'Visual and writing guidelines' },
  { name: 'primaryLogo', group: 'Brand', description: 'Link to the main logo (empty when there is none)' },
  { name: 'secondaryLogo', group: 'Brand', description: 'Link to the second logo' },
  { name: 'tertiaryLogo', group: 'Brand', description: 'Link to the third logo' },
  // Campaign
  { name: 'campaign', aliasOf: 'campaignDetails', group: 'Campaign', description: 'The campaign: name, description, goals, core messages, hashtags, dates' },
  { name: 'campaignName', group: 'Campaign', description: 'The campaign’s name' },
  { name: 'coreMessages', group: 'Campaign', description: 'The campaign’s core messages' },
  { name: 'hashtags', group: 'Campaign', description: 'The campaign’s hashtags, comma separated' },
  // Post
  { name: 'postTitle', aliasOf: 'taskName', group: 'Post', description: 'The post’s title (internal)' },
  { name: 'brief', aliasOf: 'taskDescription', group: 'Post', description: 'The post’s brief: what it should achieve and show' },
  { name: 'caption', aliasOf: 'taskContent', group: 'Post', description: 'The post’s caption (the text that gets published)' },
  { name: 'instruction', group: 'Post', description: 'Improve caption or Change image: what to change (e.g. “make it shorter”, “make the sky a sunset”)' },
  { name: 'platform', group: 'Post', description: 'Improve caption: the platform to fit, when one was chosen' },
  // Images
  { name: 'image', aliasOf: 'baseImage', group: 'Images', description: 'Link to the post’s current picture (empty in Create image, which starts fresh)' },
  { name: 'referenceImage1', aliasOf: 'attachedImage1', group: 'Images', description: 'Link to reference image 1 (2, 3 … also work)' },
  { name: 'references', group: 'Images', description: 'Create image: what each reference picture is for (“Include this” or “Copy this style”); the pictures themselves are always sent' },
  { name: 'format', group: 'Images', description: 'Create image: the shape (square, portrait or landscape)' },
  { name: 'logoNote', group: 'Images', description: 'Create or Change image: where the real logo will be placed (or that there is none)' },
  // Steps
  { name: 'previousOutput', group: 'Steps', description: 'In a multi-step command: the previous step’s answer' },
  // Older names (still work)
  { name: 'companyInfo', group: 'Brand', legacy: true, description: 'Older name for {brand}' },
  { name: 'companyName', group: 'Brand', legacy: true, description: 'Older name for {brandName}' },
  { name: 'campaignDetails', group: 'Campaign', legacy: true, description: 'Older name for {campaign}' },
  { name: 'taskName', group: 'Post', legacy: true, description: 'Older name for {postTitle}' },
  { name: 'taskDescription', group: 'Post', legacy: true, description: 'Older name for {brief}' },
  { name: 'taskContent', group: 'Post', legacy: true, description: 'Older name for {caption}' },
  { name: 'baseImage', group: 'Images', legacy: true, description: 'Older name for {image}' },
  { name: 'attachedImage1', group: 'Images', legacy: true, description: 'Older name for {referenceImage1}' }
];

const ALIASES: Record<string, string> = Object.fromEntries(PLACEHOLDERS.filter((p) => p.aliasOf).map((p) => [p.name, p.aliasOf!]));

const NUMBERED = /^(attachedImage|referenceImage)(\d+)$/;

/** Every name the compiler understands (without braces). */
export function isKnownPlaceholder(name: string): boolean {
  return PLACEHOLDERS.some((p) => p.name === name) || NUMBERED.test(name);
}

/** Rewrites new names to the older ones the compiler fills: "{brief}" → "{taskDescription}". */
export function applyPlaceholderAliases(template: string): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) => {
    if (ALIASES[name]) return `{${ALIASES[name]}}`;
    const numbered = name.match(/^referenceImage(\d+)$/);
    if (numbered) return `{attachedImage${numbered[1]}}`;
    return whole;
  });
}

/** Regex for every known name (old and new), for clearing the ones left without data. */
export function knownPlaceholderRegex(): RegExp {
  const names = PLACEHOLDERS.map((p) => p.name).filter((n) => !NUMBERED.test(n));
  return new RegExp(`\\{(${[...names, 'attachedImage\\d+', 'referenceImage\\d+'].join('|')})\\}`, 'g');
}

export interface PlaceholderCheck {
  /** {names} in the prompt that the app doesn't know (probably typos). */
  unknown: { name: string; suggestion?: string }[];
  /** Known names used. */
  used: string[];
}

function distance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
  }
  return d[x.length][y.length];
}

/**
 * Finds {placeholders} a prompt uses and the ones the app doesn't know, with a likely intended
 * name. Text like {"key": 1} (JSON examples) isn't a placeholder and is ignored. Custom values
 * passed by a command (e.g. {tone} from the connector's run_prompt) are listed as unknown here; the
 * prompt editor shows them as a warning, not an error.
 */
export function checkPlaceholders(template: string): PlaceholderCheck {
  const found = [...new Set([...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]))];
  const used = found.filter(isKnownPlaceholder);
  const suggestible = PLACEHOLDERS.filter((p) => !p.legacy).map((p) => p.name);
  const unknown = found
    .filter((n) => !isKnownPlaceholder(n))
    .map((name) => {
      let best: string | undefined;
      let bestScore = Infinity;
      for (const s of suggestible) {
        const score = distance(name, s);
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }
      // Only suggest close matches (a typo or two), e.g. {companyNmae} → {brandName}'s older name.
      const legacyMatch = PLACEHOLDERS.find((p) => p.legacy && distance(name, p.name) <= 2);
      if (legacyMatch) return { name, suggestion: PLACEHOLDERS.find((p) => p.aliasOf === legacyMatch.name)?.name || legacyMatch.name };
      return bestScore <= Math.max(2, Math.floor(name.length / 4)) ? { name, suggestion: best } : { name };
    });
  return { unknown, used };
}
