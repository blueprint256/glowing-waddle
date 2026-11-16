import type { NeutralMessage, PendingAction } from './types';

/**
 * Turn stored history into what the chat panel shows (also used when reopening a chat).
 */
export type TranscriptItem =
  | { kind: 'user'; text: string; at?: string }
  | { kind: 'assistant'; text: string; at?: string }
  | { kind: 'tool'; id: string; name: string; ok: boolean; data?: unknown; error?: string }
  | { kind: 'confirm'; pending: PendingAction };

export function toTranscript(messages: NeutralMessage[], pending?: PendingAction | null): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      items.push({ kind: 'user', text: m.text, at: m.at });
    } else if (m.role === 'assistant') {
      if (m.text) items.push({ kind: 'assistant', text: m.text, at: m.at });
    } else {
      for (const r of m.results) {
        if (r.isError) {
          items.push({ kind: 'tool', id: r.id, name: r.name, ok: false, error: r.content });
        } else {
          let data: unknown;
          try {
            data = JSON.parse(r.content);
          } catch {
            data = undefined; // truncated result: show as a done step without a card
          }
          items.push({ kind: 'tool', id: r.id, name: r.name, ok: true, data });
        }
      }
    }
  }
  if (pending) items.push({ kind: 'confirm', pending });
  return items;
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || 'New chat';
}
