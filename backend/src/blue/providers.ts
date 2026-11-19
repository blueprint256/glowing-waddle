import type { ChatProvider, NeutralMessage, ToolCall, ToolSpec, ProviderTurn } from './types';
import type { JsonSchema } from '../mcp/validate';

/**
 * Tool-calling chat adapters for Blue, over plain HTTPS (no SDK), so the request/response shapes
 * are explicit and unit-tested (scripts/blueSelfTest.ts).
 *   - Anthropic Messages API (Claude)
 *   - OpenAI-compatible Chat Completions (OpenAI, xAI Grok)
 */

export class ProviderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<FetchResponseLike>;

const defaultFetch: FetchLike = (url, init) => (globalThis as any).fetch(url, init);

const REQUEST_TIMEOUT_MS = 120_000;

/** Drop JSON-Schema keywords some providers reject (our custom "format"). */
export function sanitizeSchema(schema: JsonSchema): JsonSchema {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: any = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'format' || key === 'default') continue;
      out[key] = walk(value);
    }
    return out;
  };
  return walk(schema);
}

export async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, label: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: FetchResponseLike;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error: any) {
    throw new ProviderError(502, error?.name === 'AbortError' ? `${label} took too long to respond` : `Could not reach ${label}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new ProviderError(res.status, `${label} error (${res.status}): ${detail}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

/** Neutral history → Anthropic messages (consecutive same-role turns are merged; tool results go first). */
export function toAnthropicMessages(messages: NeutralMessage[]): any[] {
  const out: { role: 'user' | 'assistant'; content: any[] }[] = [];
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.text) push('user', [{ type: 'text', text: m.text }]);
    } else if (m.role === 'assistant') {
      const blocks: any[] = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls || []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      push('assistant', blocks);
    } else {
      push(
        'user',
        m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) }))
      );
    }
  }
  // Tool results must come before any text in a user turn.
  for (const turn of out) {
    if (turn.role === 'user') {
      turn.content.sort((a, b) => (a.type === 'tool_result' ? 0 : 1) - (b.type === 'tool_result' ? 0 : 1));
    }
  }
  return out;
}

export function parseAnthropicResponse(json: any): ProviderTurn {
  const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: String(b.id), name: String(b.name), args: b.input && typeof b.input === 'object' ? b.input : {} }));
  const u = json?.usage || {};
  return {
    text,
    toolCalls,
    usage: {
      input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      output: u.output_tokens || 0
    }
  };
}

export function buildAnthropicRequest(model: string, system: string, messages: NeutralMessage[], tools: ToolSpec[]) {
  return {
    model,
    max_tokens: 4096,
    // Prompt caching: the system prompt and tool list are identical on every step of a conversation.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: toAnthropicMessages(messages),
    ...(tools.length
      ? {
          tools: tools.map((t, i) => ({
            name: t.name,
            description: t.description,
            input_schema: sanitizeSchema(t.parameters),
            ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {})
          }))
        }
      : {})
  };
}

export function createAnthropicProvider(opts: { apiKey: string; model: string; fetchImpl?: FetchLike; baseUrl?: string }): ChatProvider {
  const fetchImpl = opts.fetchImpl || defaultFetch;
  const url = `${opts.baseUrl || 'https://api.anthropic.com'}/v1/messages`;
  return {
    provider: 'anthropic',
    model: opts.model,
    async complete({ system, messages, tools }) {
      const json = await postJson(
        fetchImpl,
        url,
        { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
        buildAnthropicRequest(opts.model, system, messages, tools),
        'Anthropic'
      );
      return parseAnthropicResponse(json);
    }
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenAI, Grok)
// ---------------------------------------------------------------------------

export function toOpenAIMessages(system: string, messages: NeutralMessage[]): any[] {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.text) out.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      const calls = m.toolCalls || [];
      if (!m.text && !calls.length) continue;
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) }
          : {})
      });
    } else {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}

export function parseOpenAIResponse(json: any): ProviderTurn {
  const message = json?.choices?.[0]?.message || {};
  const toolCalls: ToolCall[] = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter((c: any) => c?.type === 'function' || c?.function)
    .map((c: any) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        args = {};
      }
      return { id: String(c.id), name: String(c.function?.name), args };
    });
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  const u = json?.usage || {};
  return { text, toolCalls, usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 } };
}

export function buildOpenAIRequest(model: string, system: string, messages: NeutralMessage[], tools: ToolSpec[]) {
  return {
    model,
    messages: toOpenAIMessages(system, messages),
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: sanitizeSchema(t.parameters) }
          })),
          tool_choice: 'auto'
        }
      : {})
  };
}

export function createOpenAICompatibleProvider(opts: {
  provider: 'openai' | 'grok';
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): ChatProvider {
  const fetchImpl = opts.fetchImpl || defaultFetch;
  const base = opts.baseUrl || (opts.provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1');
  const label = opts.provider === 'grok' ? 'Grok' : 'OpenAI';
  return {
    provider: opts.provider,
    model: opts.model,
    async complete({ system, messages, tools }) {
      const json = await postJson(
        fetchImpl,
        `${base}/chat/completions`,
        { Authorization: `Bearer ${opts.apiKey}` },
        buildOpenAIRequest(opts.model, system, messages, tools),
        label
      );
      return parseOpenAIResponse(json);
    }
  };
}
