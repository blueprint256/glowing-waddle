import { create } from 'zustand';
import { inboxAPI, outreachAPI, type InboxSummary } from '../services/inbox';

/** Inbox badge counts, refreshed every minute while the app is open (and on demand after actions). */
interface InboxState {
  summary: InboxSummary;
  supportUnread: number;
  refresh: (admin?: boolean) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set) => ({
  summary: { action: 0, updates: 0, messages: 0, badge: 0 },
  supportUnread: 0,
  refresh: async (admin = false) => {
    try {
      const [summary, overview] = await Promise.all([inboxAPI.summary(), admin ? outreachAPI.overview().catch(() => null) : Promise.resolve(null)]);
      set({ summary, ...(overview ? { supportUnread: overview.support.unread } : {}) });
    } catch {
      /* keep the last counts */
    }
  }
}));
