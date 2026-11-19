import { postJson, type FetchLike } from '../blue/providers';

/**
 * One structured call to Claude for the design steps: the answer is forced through a single tool
 * whose input schema is the shape we need, so it arrives as checked JSON, never as prose to parse.
 * The long, stable part of the prompt (rules, brand, design catalogue) is cached.
 */

export const DESIGN_MODELS = {
  /** Art direction and copy: picks designs, writes the words, briefs the background. */
  director: 'claude-sonnet-5-5',
  /** Typed edits ("bigger headline"), shortening, quick reads. */
  quick: 'claude-haiku-5-5',
  /** Ranking the rendered options by looking at them. */
  critic: 'claude-sonnet-5-5',
  /** Turning a reference poster into a library design (admin, rare). */
  importer: 'claude-opus-5-5'
};

/** US$ per million tokens (November 2026 list prices). */
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
};

export interface ClaudeImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  /** Shown to the model just before the image. */
  label?: string;
}

export interface ClaudeToolCall<T> {
  input: T;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number;
  model: string;
}

export interface ClaudeToolRequest {
  apiKey: string;
  model: string;
  /** Stable instructions (cached). */
  system: string;
  /** Stable context that follows the instructions, e.g. the brand and the design catalogue (cached). */
  context?: string;
  /** This request's message. */
  prompt: string;
  images?: ClaudeImage[];
  tool: { name: string; description: string; schema: Record<string, unknown> };
  maxTokens?: number;
  fetchImpl?: FetchLike;
}

const defaultFetch: FetchLike = (url, init) => (globalThis as any).fetch(url, init);

export function buildToolRequest(req: ClaudeToolRequest) {
  const system: any[] = [{ type: 'text', text: req.system, ...(req.context ? {} : { cache_control: { type: 'ephemeral' } }) }];
  if (req.context) system.push({ type: 'text', text: req.context, cache_control: { type: 'ephemeral' } });
  const content: any[] = [];
  for (const img of req.images || []) {
    if (img.label) content.push({ type: 'text', text: img.label });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  }
  content.push({ type: 'text', text: req.prompt });
  return {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    system,
    messages: [{ role: 'user', content }],
    tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema }],
    tool_choice: { type: 'tool', name: req.tool.name }
  };
}

export function costOf(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const p = PRICES[model] || PRICES['claude-sonnet-5-5'];
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

export async function callClaudeTool<T>(req: ClaudeToolRequest): Promise<ClaudeToolCall<T>> {
  const json = await postJson(
    req.fetchImpl || defaultFetch,
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': req.apiKey, 'anthropic-version': '2023-06-01' },
    buildToolRequest(req),
    'Anthropic'
  );
  const block = (Array.isArray(json?.content) ? json.content : []).find((b: any) => b.type === 'tool_use' && b.name === req.tool.name);
  if (!block || typeof block.input !== 'object') throw new Error('The design AI didn’t return a plan. Try again.');
  const u = json?.usage || {};
  const usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
  return { input: block.input as T, usage, cost: costOf(req.model, usage), model: req.model };
}
