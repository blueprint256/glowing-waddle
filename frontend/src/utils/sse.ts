/**
 * Minimal Server-Sent Events parser for fetch() streams (EventSource can't POST).
 * Feed it the accumulated text; it returns complete events and the unfinished remainder.
 */
export interface SSEMessage {
  event: string;
  data: unknown;
}

export function parseSSE(buffer: string): { events: SSEMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SSEMessage[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    const raw = data.join('\n');
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* plain text event */
    }
    events.push({ event, data: parsed });
  }
  return { events, rest };
}
