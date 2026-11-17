/**
 * Understanding short typed replies to an Inbox item ("yes", "not now", "remind me later",
 * "posted it: https://…"). Pure functions: the server first tries these rules, and only asks the AI
 * when the reply doesn't match anything.
 */

export interface ActionLike {
  id: string;
  label: string;
  link?: string;
  style?: string;
}

export type Intent = { action: string; value?: string } | null;

const YES = /^(y|ya|yes|yeah|yep|yup|sure|ok|okay|k|go|go ahead|do it|please do|send( it)?( now)?|publish( it)?( now)?|post( it)?( now)?|confirm(ed)?|retry|try again|👍|✅)\b/i;
const NO = /^(n|no|nope|nah|not now|don'?t|do not|cancel|stop|keep( it)?( as is)?|leave( it)?|skip|ignore)\b/i;
const LATER = /\b(later|remind me|snooze|tomorrow|in an hour|in 1 hour|after)\b/i;
const URL = /https?:\/\/\S+/i;

/** Primary action = first non-link action marked primary, else the first non-link action. */
export function primaryAction(actions: ActionLike[]): ActionLike | undefined {
  const runnable = actions.filter((a) => !a.link);
  return runnable.find((a) => a.style === 'primary') || runnable[0];
}

export function matchIntent(text: string, actions: ActionLike[]): Intent {
  const t = text.trim().replace(/[.!]+$/, '');
  if (!t) return null;
  const ids = new Set(actions.map((a) => a.id));
  const url = t.match(URL)?.[0];
  if (url && ids.has('mark_posted')) return { action: 'mark_posted', value: url };
  // The reply is exactly a button's label ("Don't post it", "Try again").
  const exact = actions.find((a) => !a.link && t.toLowerCase() === a.label.toLowerCase().replace(/[.!]+$/, ''));
  if (exact) return { action: exact.id };
  if (LATER.test(t) && ids.has('snooze')) return { action: 'snooze' };
  if (NO.test(t)) {
    for (const id of ['keep', 'dismiss']) if (ids.has(id)) return { action: id };
    return { action: 'dismiss' };
  }
  if (YES.test(t)) {
    const p = primaryAction(actions);
    return p ? { action: p.id } : null;
  }
  // The reply names an action ("mark as posted", "retry", "publish now").
  const lower = t.toLowerCase();
  const named = actions.find((a) => !a.link && (lower === a.label.toLowerCase() || lower.includes(a.label.toLowerCase())));
  return named ? { action: named.id } : null;
}

/** Prompt for the AI fallback: choose one action id or "none". */
export function intentPrompt(item: { title: string; body: string }, actions: ActionLike[], reply: string): string {
  return [
    'A user replied to a notification in a marketing app. Decide which ONE of the available actions they want.',
    `Notification title: ${item.title}`,
    `Notification text: ${item.body.slice(0, 800)}`,
    `Available actions (id: label): ${actions.filter((a) => !a.link).map((a) => `${a.id}: ${a.label}`).join('; ')}; dismiss: Close this notification`,
    `User reply: """${reply.slice(0, 500)}"""`,
    'Answer with JSON only: {"action": "<id or none>", "value": "<link or empty>"}. Use "none" if the reply is a question, unclear, or asks for something not listed.'
  ].join('\n');
}

export function parseIntentReply(raw: string, actions: ActionLike[]): Intent {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const ok = new Set([...actions.filter((a) => !a.link).map((a) => a.id), 'dismiss']);
    if (typeof j.action === 'string' && ok.has(j.action)) return { action: j.action, value: typeof j.value === 'string' && j.value ? j.value : undefined };
  } catch {
    /* fall through */
  }
  return null;
}
