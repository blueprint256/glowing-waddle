import api from './api';
import { parseSSE } from '../utils/sse';

/** Blue, the in-app assistant: API client (JSON endpoints via axios, streaming via fetch). */

export interface BlueAction {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface BluePending {
  calls: BlueAction[];
  summaries: string[];
  createdAt: string;
}

export type BlueItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; ok: boolean; data?: any; error?: string; running?: boolean; title?: string }
  | { kind: 'confirm'; pending: BluePending; resolved?: 'approved' | 'declined' }
  | { kind: 'error'; message: string };

export type BlueEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_start'; id: string; name: string; title: string }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'confirm'; pending: BluePending }
  | { type: 'error'; message: string }
  | { type: 'done'; remainingToday: number | null };

export interface BlueStatus {
  available: boolean;
  reason?: string;
  code?: string;
  dailyMessageLimit: number;
  remainingToday: number | null;
  /** Monthly allowance left (null = no limit). */
  remainingThisMonth?: number | null;
  monthlyResetsAt?: string;
}

export interface BlueConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface BlueSettings {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'grok' | null;
  model: string;
  dailyMessageLimit: number;
  effectiveProvider: string | null;
  effectiveModel: string | null;
  problem: string | null;
  configuredProviders: Array<'anthropic' | 'openai' | 'grok'>;
  defaultModels: Record<string, string | undefined>;
}

export class BlueHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

const API_URL = import.meta.env.VITE_API_URL || '/api';

export const blueAPI = {
  status: () => api.get<{ success: boolean } & BlueStatus>('/blue/status'),
  list: () => api.get<{ conversations: BlueConversationSummary[] }>('/blue/conversations'),
  create: () => api.post<{ conversation: { id: string; title: string; items: BlueItem[] } }>('/blue/conversations'),
  get: (id: string) => api.get<{ conversation: { id: string; title: string; items: BlueItem[]; busy: boolean } }>(`/blue/conversations/${id}`),
  remove: (id: string) => api.delete(`/blue/conversations/${id}`),
  getSettings: () => api.get<{ settings: BlueSettings }>('/blue/settings'),
  saveSettings: (data: Partial<Pick<BlueSettings, 'enabled' | 'provider' | 'model' | 'dailyMessageLimit'>>) =>
    api.patch<{ settings: BlueSettings; message: string }>('/blue/settings', data)
};

function clientContext() {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  // With the query, so Blue knows about an open post (?post=) or a Planner filter (?campaign=).
  return { timeZone, path: window.location.pathname + window.location.search };
}

/** POST and stream Blue's events until the run finishes. */
export async function streamBlue(
  conversationId: string,
  action: 'messages' | 'confirm',
  body: Record<string, unknown>,
  onEvent: (event: BlueEvent) => void
): Promise<void> {
  const res = await fetch(`${API_URL}/blue/conversations/${conversationId}/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ...body, ...clientContext() })
  });

  if (!res.ok || !res.body) {
    let message = 'Blue could not respond. Please try again.';
    let code: string | undefined;
    try {
      const json = await res.json();
      message = json.message || message;
      code = json.code;
    } catch {
      /* not JSON */
    }
    throw new BlueHttpError(res.status, message, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSE(buffer);
    buffer = rest;
    for (const e of events) onEvent(e.data as BlueEvent);
  }
  buffer += decoder.decode();
  const { events } = parseSSE(`${buffer}\n\n`);
  for (const e of events) onEvent(e.data as BlueEvent);
}
