import { postJson, type FetchLike } from '../blue/providers';

/**
 * One structured call to Claude for the design steps: the answer comes through a single tool whose
 * input schema is the shape we need, so it arrives as JSON, never as prose to parse. The long,
 * stable part of the prompt (rules, brand, design catalogue) is cached.
 *
 * Current models (Sonnet 5.5, Opus 5.5 and others) refuse forced tool use (tool_choice "tool" or
 * "any" is a 400 error), so the tool is offered with tool_choice "auto" and the prompt says to
 * answer only through it; if the model answers in words anyway, it's asked once more to call it.
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
  /** Long answers (a whole design) take minutes. */
  timeoutMs?: number;
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
  content.push({ type: 'text', text: `${req.prompt}\n\n${answerRule(req.tool.name)}` });
  return {
    model: req.model,
    // Room for a little thinking or a sentence before the tool call.
    max_tokens: (req.maxTokens ?? 4096) + 1024,
    system,
    messages: [{ role: 'user', content }],
    tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema }],
    tool_choice: { type: 'auto' }
  };
}

const answerRule = (tool: string) => `Answer only by calling the ${tool} tool, once, with the complete answer. Don't reply in words.`;

const toolBlock = (json: any, name: string) => (Array.isArray(json?.content) ? json.content : []).find((b: any) => b.type === 'tool_use' && b.name === name);

export function costOf(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const p = PRICES[model] || PRICES['claude-sonnet-5-5'];
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

export async function callClaudeTool<T>(req: ClaudeToolRequest): Promise<ClaudeToolCall<T>> {
  const send = (body: unknown) =>
    postJson(req.fetchImpl || defaultFetch, 'https://api.anthropic.com/v1/messages', { 'x-api-key': req.apiKey, 'anthropic-version': '2023-06-01' }, body, 'Anthropic', req.timeoutMs);
  const body = buildToolRequest(req);
  let json = await send(body);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const add = (j: any) => {
    const u = j?.usage || {};
    usage.input += u.input_tokens || 0;
    usage.output += u.output_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.cacheWrite += u.cache_creation_input_tokens || 0;
  };
  add(json);
  let block = toolBlock(json, req.tool.name);
  if (!block && Array.isArray(json?.content)) {
    // It answered in words: once more, asking for the tool call.
    json = await send({
      ...body,
      messages: [...body.messages, { role: 'assistant', content: json.content }, { role: 'user', content: [{ type: 'text', text: answerRule(req.tool.name) }] }]
    });
    add(json);
    block = toolBlock(json, req.tool.name);
  }
  if (!block || typeof block.input !== 'object') throw new Error('The design AI didn’t return a plan. Try again.');
  return { input: block.input as T, usage, cost: costOf(req.model, usage), model: req.model };
}
