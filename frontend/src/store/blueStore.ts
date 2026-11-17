import { create } from 'zustand';
import {
  blueAPI,
  streamBlue,
  BlueHttpError,
  type BlueConversationSummary,
  type BlueEvent,
  type BlueItem,
  type BlueStatus
} from '../services/blue';

/** Tools that only read data; anything else may have changed what the page shows. */
const isReadOnly = (name: string) => name.startsWith('get_') || name.startsWith('list_') || name === 'refine_task_description';

const OPEN_KEY = 'blue:open';
const EXPANDED_KEY = 'blue:expanded';
const LAST_KEY = 'blue:lastConversation';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}
function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
function writeLast(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

/** Something from the chat opened in the right-hand panel of the full-screen Blue page. */
export interface BlueDetailRef {
  type: 'task' | 'library' | 'campaign' | 'project';
  id: string;
  /** What the chat card already knows, shown instantly while the full record loads. */
  preview?: any;
}

interface BlueState {
  open: boolean;
  expanded: boolean;
  status: BlueStatus | null;
  conversations: BlueConversationSummary[];
  conversationId: string | null;
  items: BlueItem[];
  busy: boolean;
  loading: boolean;
  /** Bumped after Blue changes data, so the page behind the panel reloads. */
  refreshKey: number;
  detail: BlueDetailRef | null;

  setOpen: (open: boolean) => void;
  toggle: () => void;
  toggleExpanded: () => void;
  init: () => Promise<void>;
  loadStatus: () => Promise<void>;
  loadConversations: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  newChat: () => void;
  deleteConversation: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  confirm: (approve: boolean) => Promise<void>;
  showDetail: (detail: BlueDetailRef) => void;
  closeDetail: () => void;
}

export const useBlueStore = create<BlueState>((set, get) => {
  /** Apply one streamed event to the transcript. Returns true if data changed. */
  const apply = (event: BlueEvent): boolean => {
    let changed = false;
    set((s) => {
      const items = [...s.items];
      switch (event.type) {
        case 'tool_start':
          items.push({ kind: 'tool', id: event.id, name: event.name, ok: true, running: true, title: event.title });
          break;
        case 'tool_result': {
          const idx = items.findIndex((i) => i.kind === 'tool' && i.id === event.id);
          const next: Extract<BlueItem, { kind: 'tool' }> = {
            kind: 'tool', id: event.id, name: event.name, ok: event.ok, data: event.data, error: event.error, running: false
          };
          if (idx >= 0) {
            const prev = items[idx];
            items[idx] = { ...next, title: prev.kind === 'tool' ? prev.title : undefined };
          } else items.push(next);
          if (event.ok && !isReadOnly(event.name)) changed = true;
          break;
        }
        case 'assistant_text':
          items.push({ kind: 'assistant', text: event.text });
          break;
        case 'confirm':
          items.push({ kind: 'confirm', pending: event.pending });
          break;
        case 'error':
          items.push({ kind: 'error', message: event.message });
          break;
        case 'done':
          return {
            items,
            status: s.status
              ? {
                  ...s.status,
                  remainingToday: event.remainingToday,
                  // One more of this month's messages used (the server counts it the same way).
                  remainingThisMonth: typeof s.status.remainingThisMonth === 'number' ? Math.max(0, s.status.remainingThisMonth - 1) : s.status.remainingThisMonth
                }
              : s.status
          };
      }
      return { items };
    });
    return changed;
  };

  const run = async (conversationId: string, action: 'messages' | 'confirm', body: Record<string, unknown>) => {
    let changed = false;
    set({ busy: true });
    try {
      await streamBlue(conversationId, action, body, (event) => {
        if (apply(event)) changed = true;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Blue could not respond. Please try again.';
      set((s) => ({ items: [...s.items, { kind: 'error', message }] }));
      if (error instanceof BlueHttpError && (error.status === 403 || error.status === 429)) get().loadStatus();
    } finally {
      set((s) => ({
        busy: false,
        // Any tool still marked running (e.g. connection dropped) is shown as finished.
        items: s.items.map((i) => (i.kind === 'tool' && i.running ? { ...i, running: false } : i)),
        refreshKey: changed ? s.refreshKey + 1 : s.refreshKey
      }));
      get().loadConversations();
    }
  };

  return {
    open: readFlag(OPEN_KEY),
    expanded: readFlag(EXPANDED_KEY),
    status: null,
    conversations: [],
    conversationId: null,
    items: [],
    busy: false,
    loading: false,
    refreshKey: 0,
    detail: null,

    showDetail: (detail) => set({ detail }),
    closeDetail: () => set({ detail: null }),

    setOpen: (open) => {
      writeFlag(OPEN_KEY, open);
      set({ open });
      if (open) get().init();
    },
    toggle: () => get().setOpen(!get().open),
    toggleExpanded: () => {
      const expanded = !get().expanded;
      writeFlag(EXPANDED_KEY, expanded);
      set({ expanded });
    },

    init: async () => {
      await Promise.all([get().loadStatus(), get().loadConversations()]);
      const last = readLast();
      if (!get().conversationId && last && get().conversations.some((c) => c.id === last)) {
        await get().openConversation(last);
      }
    },

    loadStatus: async () => {
      try {
        const res = await blueAPI.status();
        set({
          status: {
            available: res.data.available,
            reason: res.data.reason,
            code: res.data.code,
            dailyMessageLimit: res.data.dailyMessageLimit,
            remainingToday: res.data.remainingToday,
            remainingThisMonth: res.data.remainingThisMonth ?? null,
            monthlyResetsAt: res.data.monthlyResetsAt
          }
        });
      } catch {
        set({ status: { available: false, reason: 'Blue is unavailable right now.', dailyMessageLimit: 0, remainingToday: null } });
      }
    },

    loadConversations: async () => {
      try {
        const res = await blueAPI.list();
        set({ conversations: res.data.conversations || [] });
      } catch {
        /* keep the current list */
      }
    },

    openConversation: async (id) => {
      set({ loading: true });
      try {
        const res = await blueAPI.get(id);
        set({ conversationId: id, items: res.data.conversation.items || [], detail: null });
        writeLast(id);
      } catch {
        writeLast(null);
        set({ conversationId: null, items: [] });
      } finally {
        set({ loading: false });
      }
    },

    newChat: () => {
      writeLast(null);
      set({ conversationId: null, items: [], detail: null });
    },

    deleteConversation: async (id) => {
      try {
        await blueAPI.remove(id);
      } finally {
        if (get().conversationId === id) get().newChat();
        get().loadConversations();
      }
    },

    send: async (text) => {
      const trimmed = text.trim();
      if (!trimmed || get().busy) return;
      let id = get().conversationId;
      if (!id) {
        try {
          const res = await blueAPI.create();
          id = res.data.conversation.id;
          set({ conversationId: id });
          writeLast(id);
        } catch {
          set((s) => ({ items: [...s.items, { kind: 'error', message: 'Could not start a chat. Please try again.' }] }));
          return;
        }
      }
      // A new message answers any open confirmation with "no".
      set((s) => ({
        items: [
          ...s.items.map((i) => (i.kind === 'confirm' && !i.resolved ? { ...i, resolved: 'declined' as const } : i)),
          { kind: 'user', text: trimmed }
        ]
      }));
      await run(id, 'messages', { text: trimmed });
    },

    confirm: async (approve) => {
      const id = get().conversationId;
      if (!id || get().busy) return;
      set((s) => ({
        items: s.items.map((i) =>
          i.kind === 'confirm' && !i.resolved ? { ...i, resolved: approve ? ('approved' as const) : ('declined' as const) } : i
        )
      }));
      await run(id, 'confirm', { approve });
    }
  };
});
