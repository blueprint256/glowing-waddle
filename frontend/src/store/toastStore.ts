import { create } from 'zustand';

/**
 * Short confirmations at the bottom of the screen ("Saved", "Scheduled for Fri 9:00"), with an
 * optional Undo. Use notify() from anywhere; ToastHost shows them one at a time.
 */
export type ToastTone = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** Shown as a button; the toast closes after it runs. */
  undo?: () => void | Promise<void>;
  /** Another button (e.g. "Open"). */
  action?: { label: string; run: () => void };
  duration: number;
}

interface ToastState {
  queue: Toast[];
  push: (t: Omit<Toast, 'id' | 'tone' | 'duration'> & Partial<Pick<Toast, 'tone' | 'duration'>>) => number;
  dismiss: (id: number) => void;
}

let next = 1;

export const useToastStore = create<ToastState>((set) => ({
  queue: [],
  push: (t) => {
    const id = next++;
    const toast: Toast = {
      id,
      tone: t.tone || 'success',
      duration: t.duration ?? (t.undo ? 6000 : t.tone === 'error' ? 7000 : 3500),
      message: t.message,
      undo: t.undo,
      action: t.action
    };
    // Keep it short: a new message replaces older ones of the same text.
    set((s) => ({ queue: [...s.queue.filter((q) => q.message !== toast.message), toast].slice(-3) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }))
}));

/** notify('Saved'), notify('Archived', { undo: () => restore() }), notify('Couldn’t save', { tone: 'error' }). */
export function notify(message: string, opts: Partial<Pick<Toast, 'tone' | 'undo' | 'action' | 'duration'>> = {}): number {
  return useToastStore.getState().push({ message, ...opts });
}

/** A readable message from an API error. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const e = error as any;
  const fromApi = e?.response?.data?.message;
  if (typeof fromApi === 'string' && fromApi.trim()) return fromApi;
  if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') return 'Can’t reach the server. Check your connection and try again.';
  if (e?.response?.status === 413) return 'That file is too big.';
  if (e?.response?.status === 429) return 'Too many requests. Wait a moment and try again.';
  return fallback;
}
