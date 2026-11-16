import type { JsonSchema } from '../mcp/validate';

/** Provider-neutral chat history (stored in BlueConversation.messages). */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** JSON of the tool's data, or an error sentence when isError. */
  content: string;
  isError: boolean;
}

export type NeutralMessage =
  | { role: 'user'; text: string; at?: string }
  | { role: 'assistant'; text?: string; toolCalls?: ToolCall[]; at?: string }
  | { role: 'tool'; results: ToolResult[]; at?: string };

/** Actions waiting for the user's Confirm / Cancel. */
export interface PendingAction {
  calls: ToolCall[];
  summaries: string[];
  createdAt: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Usage {
  input: number;
  output: number;
}

export interface ProviderTurn {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
}

export interface ChatProvider {
  provider: 'anthropic' | 'openai' | 'grok';
  model: string;
  complete(request: { system: string; messages: NeutralMessage[]; tools: ToolSpec[] }): Promise<ProviderTurn>;
}

/** Events streamed to the browser while Blue works. */
export type BlueEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_start'; id: string; name: string; title: string }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'confirm'; pending: PendingAction }
  | { type: 'error'; message: string }
  | { type: 'done'; remainingToday: number | null };
