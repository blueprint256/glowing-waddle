import api, { API_URL } from './api';

/** Publishing: connected accounts, posts and admin platform keys. */

export type PlatformId = 'x' | 'linkedin' | 'facebook' | 'instagram' | 'tiktok' | 'youtube';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'processing' | 'published' | 'failed' | 'cancelled' | 'due';

export interface PlatformInfo {
  id: PlatformId;
  name: string;
  provider: string;
  ready: boolean;
  approvalNote: string;
  rules: { maxText: number; videoRequired: boolean; mediaRequired: boolean; titleRequired: boolean };
}

export interface PublishingStatus {
  available: boolean;
  reason?: string;
  testMode: boolean;
  platforms: PlatformInfo[];
  counts: { upcoming: number; attention: number; published: number; drafts: number } | null;
}

export interface Channel {
  id: string;
  platform: PlatformId;
  platformName: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  accountType: string;
  simulated: boolean;
  status: 'active' | 'reconnect' | 'disabled';
  lastError: string | null;
  lastUsedAt: string | null;
}

export interface Post {
  id: string;
  groupId: string;
  platform: PlatformId;
  platformName: string;
  mode: 'auto' | 'manual';
  status: PostStatus;
  text: string;
  media: { index: number; kind: 'image' | 'video'; name?: string; mime?: string; size?: number; source: string; url?: string; assetId?: string }[];
  options: Record<string, any>;
  scheduledAt: string | null;
  publishedAt: string | null;
  remoteUrl: string | null;
  progress: string | null;
  lastError: string | null;
  attempts: number;
  channel: { id: string; name?: string; username?: string; avatarUrl?: string; simulated?: boolean; status?: string } | null;
  task: { id: string; name?: string } | null;
  campaign: { id: string; name?: string } | null;
  events: { at: string; type: string; message?: string }[];
  createdAt: string;
}

export interface MediaChoice {
  source: 'url' | 'library';
  url?: string;
  assetId?: string;
  label: string;
  kind: 'image' | 'video';
  previewUrl?: string;
  isMain?: boolean;
}

export interface TargetCheck {
  key: string;
  label: string;
  platform: PlatformId;
  mode: 'auto' | 'manual';
  problems: { level: 'error' | 'warning'; message: string }[];
}

export interface PostPayload {
  taskId?: string;
  text: string;
  media: { source: 'url' | 'library'; url?: string; assetId?: string }[];
  targets: ({ channelId: string } | { platform: PlatformId })[];
  when?: 'now' | 'schedule' | 'draft';
  scheduledAt?: string;
  options?: Partial<Record<PlatformId, Record<string, unknown>>>;
}

export const publishingAPI = {
  status: () => api.get<PublishingStatus>('/publishing/status').then((r) => r.data),
  channels: () => api.get<{ channels: Channel[] }>('/publishing/channels').then((r) => r.data.channels),
  connect: (provider: string, returnTo?: string) => api.post<{ url: string }>(`/publishing/connect/${provider}`, { returnTo }).then((r) => r.data.url),
  addTestChannel: (platform: PlatformId) => api.post<{ channel: Channel }>('/publishing/channels/test', { platform }).then((r) => r.data.channel),
  channelOptions: (id: string) => api.get<{ options: Record<string, any> }>(`/publishing/channels/${id}/options`).then((r) => r.data.options),
  disconnect: (id: string) => api.delete(`/publishing/channels/${id}`).then((r) => r.data),
  taskMedia: (taskId: string) =>
    api.get<{ task: { id: string; name: string; content: string; taskDate: string | null }; media: MediaChoice[] }>(`/publishing/tasks/${taskId}/media`).then((r) => r.data),
  check: (body: PostPayload) => api.post<{ ok: boolean; targets: TargetCheck[] }>('/publishing/posts/check', body).then((r) => r.data),
  create: (body: PostPayload) => api.post<{ posts: Post[] }>('/publishing/posts', body).then((r) => r.data.posts),
  list: (params: Record<string, string | number | undefined>) =>
    api.get<{ posts: Post[]; total: number; page: number; limit: number }>('/publishing/posts', { params }).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.patch<{ post: Post }>(`/publishing/posts/${id}`, body).then((r) => r.data.post),
  cancel: (id: string) => api.post<{ post: Post }>(`/publishing/posts/${id}/cancel`).then((r) => r.data.post),
  retry: (id: string) => api.post<{ post: Post }>(`/publishing/posts/${id}/retry`).then((r) => r.data.post),
  markPublished: (id: string, url?: string) => api.post<{ post: Post }>(`/publishing/posts/${id}/mark-published`, { url }).then((r) => r.data.post),
  remove: (id: string) => api.delete(`/publishing/posts/${id}`).then((r) => r.data),
  fileUrl: (id: string, index: number) => `${API_URL.replace(/\/$/, '')}/publishing/posts/${id}/files/${index}`,
  settings: () => api.get('/publishing/settings').then((r) => r.data.settings),
  saveSettings: (body: Record<string, unknown>) => api.patch('/publishing/settings', body).then((r) => r.data.settings)
};

export const PLATFORM_COLORS: Record<PlatformId, string> = {
  x: '#111111',
  linkedin: '#0A66C2',
  facebook: '#1877F2',
  instagram: '#C13584',
  tiktok: '#111111',
  youtube: '#FF0000'
};

export const PLATFORM_ORDER: PlatformId[] = ['facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'youtube'];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube'
};

export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  publishing: 'Publishing…',
  processing: 'Processing…',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
  due: 'Post by hand now'
};

export function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** <input type="datetime-local"> value for a Date, in the user's local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
