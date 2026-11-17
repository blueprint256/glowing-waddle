import api from './api';

/** Inbox (every user) and Outreach (System Admin) API client. */

export type InboxBox = 'action' | 'update' | 'message';

export interface InboxAction {
  id: string;
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
  link?: string;
  input?: { label: string; placeholder?: string; optional?: boolean };
  confirm?: string;
}

export interface InboxItem {
  id: string;
  box: InboxBox;
  category: string;
  source: 'system' | 'admin' | 'support';
  title: string;
  body: string;
  fromName: string;
  actions: InboxAction[];
  link: string | null;
  status: 'open' | 'done' | 'dismissed' | 'expired';
  read: boolean;
  actedAt: string | null;
  actionTaken: string | null;
  resultMessage: string | null;
  snoozedUntil: string | null;
  threadId: string | null;
  announcementId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxSummary {
  action: number;
  updates: number;
  messages: number;
  badge: number;
}

export interface ThreadMessage {
  id: string;
  author: string;
  fromAdmin: boolean;
  body: string;
  at: string;
}

export interface Thread {
  id: string;
  subject: string;
  status: 'open' | 'resolved';
  user: { id: string; name?: string; email?: string; company?: string };
  unread: number;
  lastMessageAt: string;
  lastFromAdmin: boolean;
  preview: string;
  announcementId: string | null;
  messages?: ThreadMessage[];
  createdAt: string;
}

export interface Audience {
  everyone: boolean;
  roles: string[];
  accessModes: string[];
  sectors: string[];
  tags: string[];
  userIds: string[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: 'announcement' | 'tip' | 'trend' | 'billing' | 'event';
  audience: Audience;
  audienceText: string;
  offerPost: boolean;
  allowReplies: boolean;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'withdrawn';
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  stats: { read: number; acted: number; replies: number } | null;
  error: string | null;
  createdAt: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  title: string;
  body: string;
  category: string;
}

export interface ActionResponse {
  item: InboxItem;
  message: string;
  openBlue?: string;
  threadId?: string;
}

export const inboxAPI = {
  summary: () => api.get<InboxSummary>('/inbox/summary').then((r) => r.data),
  items: (box: InboxBox, status: 'open' | 'all' = 'open') => api.get<{ items: InboxItem[]; total: number }>('/inbox/items', { params: { box, status, limit: 100 } }).then((r) => r.data),
  read: (id: string) => api.post<{ item: InboxItem }>(`/inbox/items/${id}/read`).then((r) => r.data.item),
  readAll: (box?: InboxBox) => api.post('/inbox/items/read-all', { box }).then((r) => r.data),
  act: (id: string, action: string, value?: string) => api.post<ActionResponse>(`/inbox/items/${id}/actions/${encodeURIComponent(action)}`, { value }).then((r) => r.data),
  reply: (id: string, text: string) => api.post<ActionResponse>(`/inbox/items/${id}/reply`, { text }, { timeout: 60_000 }).then((r) => r.data),
  preferences: () => api.get<{ muted: string[]; mutable: string[] }>('/inbox/preferences').then((r) => r.data),
  savePreferences: (muted: string[]) => api.put('/inbox/preferences', { muted }).then((r) => r.data),
  threads: () => api.get<{ threads: Thread[] }>('/inbox/threads').then((r) => r.data.threads),
  thread: (id: string) => api.get<{ thread: Thread }>(`/inbox/threads/${id}`).then((r) => r.data.thread),
  startThread: (subject: string, body: string) => api.post<{ thread: Thread }>('/inbox/threads', { subject, body }).then((r) => r.data.thread),
  sendMessage: (id: string, body: string) => api.post<{ thread: Thread }>(`/inbox/threads/${id}/messages`, { body }).then((r) => r.data.thread)
};

export const outreachAPI = {
  overview: () =>
    api
      .get<{ overview: { attention: { category: string; label: string; items: number; users: number }[]; support: { open: number; unread: number }; scheduledMessages: number } }>(
        '/inbox/admin/overview'
      )
      .then((r) => r.data.overview),
  audienceOptions: () =>
    api.get<{ sectors: { value: string; count: number }[]; tags: { value: string; count: number }[] }>('/inbox/admin/audience-options').then((r) => r.data),
  audienceCount: (audience: Audience) => api.post<{ count: number; description: string }>('/inbox/admin/audience-count', { audience }).then((r) => r.data),
  announcements: () => api.get<{ announcements: Announcement[] }>('/inbox/admin/announcements').then((r) => r.data.announcements),
  create: (body: Record<string, unknown>) => api.post<{ announcement: Announcement }>('/inbox/admin/announcements', body, { timeout: 120_000 }).then((r) => r.data.announcement),
  update: (id: string, body: Record<string, unknown>) => api.patch<{ announcement: Announcement }>(`/inbox/admin/announcements/${id}`, body).then((r) => r.data.announcement),
  send: (id: string) => api.post<{ announcement: Announcement }>(`/inbox/admin/announcements/${id}/send`, {}, { timeout: 120_000 }).then((r) => r.data.announcement),
  cancel: (id: string) => api.post(`/inbox/admin/announcements/${id}/cancel`).then((r) => r.data),
  withdraw: (id: string) => api.post(`/inbox/admin/announcements/${id}/withdraw`).then((r) => r.data),
  remove: (id: string) => api.delete(`/inbox/admin/announcements/${id}`).then((r) => r.data),
  threads: (status: 'open' | 'resolved' | 'all') => api.get<{ threads: Thread[] }>('/inbox/admin/threads', { params: { status } }).then((r) => r.data.threads),
  thread: (id: string) => api.get<{ thread: Thread }>(`/inbox/admin/threads/${id}`).then((r) => r.data.thread),
  reply: (id: string, body: string) => api.post<{ thread: Thread }>(`/inbox/admin/threads/${id}/messages`, { body }).then((r) => r.data.thread),
  setThreadStatus: (id: string, status: 'open' | 'resolved') => api.patch<{ thread: Thread }>(`/inbox/admin/threads/${id}`, { status }).then((r) => r.data.thread),
  templates: () => api.get<{ templates: MessageTemplate[] }>('/inbox/admin/templates').then((r) => r.data.templates),
  saveTemplate: (body: Record<string, unknown>) => api.post<{ template: MessageTemplate }>('/inbox/admin/templates', body).then((r) => r.data.template),
  deleteTemplate: (id: string) => api.delete(`/inbox/admin/templates/${id}`).then((r) => r.data)
};

export const CATEGORY_LABELS: Record<string, string> = {
  announcement: 'Announcement',
  tip: 'Tip',
  trend: 'News & trends',
  billing: 'Billing',
  event: 'Upcoming day',
  support: 'Conversation',
  post_due: 'Post by hand',
  post_failed: 'Failed post',
  post_upcoming: 'Upcoming post',
  channel_reconnect: 'Account',
  library_review: 'Library',
  ai_limit: 'AI allowance'
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
