import { ToolDefinition, ToolError, availableTools } from '../mcp/protocol';
import { validateArgs } from '../mcp/validate';
import { ApiError } from '../mcp/apiClient';
import type { BlueEvent, ChatProvider, NeutralMessage, PendingAction, ToolCall, ToolResult, ToolSpec, Usage } from './types';

/**
 * Blue's agent loop (dependency-free, unit-tested in scripts/blueSelfTest.ts).
 *
 * The model proposes tool calls; we run them as the user through the same tool catalog as the
 * Claude connector. Destructive tools (archive, delete, remove, deactivate) are never run straight
 * away: the loop stops and the UI asks the user to Confirm or Cancel.
 */

export interface AgentOptions<Ctx> {
  provider: ChatProvider;
  system: string;
  messages: NeutralMessage[];
  tools: ToolDefinition<Ctx>[];
  ctx: Ctx;
  onEvent: (event: BlueEvent) => void;
  maxSteps?: number;
  log?: (message: string, error?: unknown) => void;
  /** Optional: human summary of a destructive call for the confirmation card. */
  describeAction?: (call: ToolCall, tool: ToolDefinition<Ctx>) => Promise<string>;
}

export interface AgentResult {
  messages: NeutralMessage[];
  pending: PendingAction | null;
  usage: Usage;
  steps: number;
  /** Set when the AI provider failed part-way; `messages` still records everything done so far. */
  error?: unknown;
}

const MAX_RESULT_CHARS = 24_000;
/** Cards in a saved chat can show more than the AI reads; above this they show as a plain step. */
const MAX_DISPLAY_CHARS = 400_000;
const now = () => new Date().toISOString();

export function isDestructive<Ctx>(tool: ToolDefinition<Ctx>): boolean {
  return tool.annotations.destructiveHint === true;
}

export function toolSpecs<Ctx>(tools: ToolDefinition<Ctx>[], ctx: Ctx): ToolSpec[] {
  return availableTools(tools, ctx).map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
}

function resultContent(data: unknown): string {
  const text = JSON.stringify(data ?? null);
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}… [truncated: ask for a narrower list if you need more]`
    : text;
}

/** Run one tool call as the user. Never throws. */
export async function executeCall<Ctx>(
  call: ToolCall,
  tools: ToolDefinition<Ctx>[],
  ctx: Ctx,
  onEvent: (event: BlueEvent) => void,
  log?: (message: string, error?: unknown) => void
): Promise<ToolResult> {
  const tool = availableTools(tools, ctx).find((t) => t.name === call.name);
  if (!tool) {
    const error = `The tool "${call.name}" is not available for this account.`;
    onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: false, error });
    return { id: call.id, name: call.name, content: error, isError: true };
  }

  onEvent({ type: 'tool_start', id: call.id, name: call.name, title: tool.title });

  const problems = validateArgs(tool.inputSchema, call.args ?? {});
  if (problems.length) {
    const error = `Invalid arguments: ${problems.join('; ')}`;
    onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: false, error });
    return { id: call.id, name: call.name, content: error, isError: true };
  }

  try {
    const data = await tool.handler(call.args ?? {}, ctx);
    onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: true, data });
    const full = JSON.stringify(data ?? null);
    const content = resultContent(data);
    return {
      id: call.id, name: call.name, content, isError: false,
      // Keep the full result for the chat cards when the AI only got a shortened copy.
      ...(content.length !== full.length && full.length <= MAX_DISPLAY_CHARS ? { display: full } : {})
    };
  } catch (err) {
    let error: string;
    if (err instanceof ToolError) error = err.message;
    else if (err instanceof ApiError) error = `Error (HTTP ${err.status}): ${err.message}`;
    else {
      log?.(`Blue tool ${call.name} failed`, err);
      error = 'Unexpected error while running this action.';
    }
    onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: false, error });
    return { id: call.id, name: call.name, content: error, isError: true };
  }
}

/** Tool results for pending calls the user declined (or skipped by sending a new message). */
export function declinedResults(pending: PendingAction, reason: string): NeutralMessage {
  return {
    role: 'tool',
    results: pending.calls.map((c) => ({ id: c.id, name: c.name, content: reason, isError: true })),
    at: now()
  };
}

export async function runAgent<Ctx>(opts: AgentOptions<Ctx>): Promise<AgentResult> {
  const messages = [...opts.messages];
  const usage: Usage = { input: 0, output: 0 };
  const maxSteps = opts.maxSteps ?? 10;
  const specs = toolSpecs(opts.tools, opts.ctx);
  let steps = 0;

  while (steps < maxSteps) {
    steps++;
    let turn;
    try {
      turn = await opts.provider.complete({ system: opts.system, messages, tools: specs });
    } catch (error) {
      return { messages, pending: null, usage, steps, error };
    }
    usage.input += turn.usage.input;
    usage.output += turn.usage.output;

    messages.push({
      role: 'assistant',
      ...(turn.text ? { text: turn.text } : {}),
      ...(turn.toolCalls.length ? { toolCalls: turn.toolCalls } : {}),
      at: now()
    });
    if (turn.text) opts.onEvent({ type: 'assistant_text', text: turn.text });
    if (!turn.toolCalls.length) return { messages, pending: null, usage, steps };

    const available = availableTools(opts.tools, opts.ctx);
    const results: ToolResult[] = [];
    const needsConfirmation: ToolCall[] = [];

    for (const call of turn.toolCalls) {
      const tool = available.find((t) => t.name === call.name);
      if (tool && isDestructive(tool)) needsConfirmation.push(call);
      else results.push(await executeCall(call, opts.tools, opts.ctx, opts.onEvent, opts.log));
    }

    if (results.length) messages.push({ role: 'tool', results, at: now() });

    if (needsConfirmation.length) {
      const summaries: string[] = [];
      for (const call of needsConfirmation) {
        const tool = available.find((t) => t.name === call.name)!;
        let summary = tool.title;
        if (opts.describeAction) {
          try {
            summary = await opts.describeAction(call, tool);
          } catch {
            /* keep the plain title */
          }
        }
        summaries.push(summary);
      }
      const pending: PendingAction = { calls: needsConfirmation, summaries, createdAt: now() };
      opts.onEvent({ type: 'confirm', pending });
      return { messages, pending, usage, steps };
    }
  }

  const note = `I stopped after ${maxSteps} steps to keep things under control. Tell me if you'd like me to continue.`;
  messages.push({ role: 'assistant', text: note, at: now() });
  opts.onEvent({ type: 'assistant_text', text: note });
  return { messages, pending: null, usage, steps };
}

/** Keep the history sent to the model bounded; only cut at a user message so tool calls stay paired. */
export function trimHistory(messages: NeutralMessage[], maxChars = 150_000): NeutralMessage[] {
  const size = (m: NeutralMessage) => JSON.stringify(m).length;
  let total = messages.reduce((n, m) => n + size(m), 0);
  let start = 0;
  while (total > maxChars && start < messages.length - 1) {
    total -= size(messages[start]);
    start++;
    while (start < messages.length - 1 && messages[start].role !== 'user') {
      total -= size(messages[start]);
      start++;
    }
  }
  return messages.slice(start);
}
