/**
 * Every app address the backend hands out (connector results, Inbox actions, Canva returns,
 * Blue) comes from here, so pages can move without breaking links. Mirrors
 * frontend/src/lib/paths.ts. Paths are relative; use absolute() for links that leave the app.
 *
 * People see "post" and "theme"; the API keeps "task" and "project".
 */

const id = (v: unknown): string => {
  if (v && typeof v === 'object' && '_id' in (v as any)) return String((v as any)._id);
  return String(v ?? '');
};

const query = (params: Record<string, string | undefined | null>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export type PublishingTab = 'queue' | 'accounts' | 'history';
export type SettingsSection = 'profile' | 'brand' | 'ai' | 'accounts' | 'integrations' | 'library' | 'blue' | 'admin';

export const links = {
  today: () => '/',
  planner: (opts: { view?: 'month' | 'week' | 'list'; date?: string; campaign?: unknown; status?: string } = {}) =>
    `/planner${query({ view: opts.view, date: opts.date, campaign: opts.campaign ? id(opts.campaign) : undefined, status: opts.status })}`,
  /** A post on its own page. */
  post: (taskId: unknown) => `/posts/${id(taskId)}`,
  campaigns: () => '/campaigns',
  campaign: (campaignId: unknown) => `/campaigns/${id(campaignId)}`,
  /** A theme (project) inside its campaign's page. */
  theme: (campaignId: unknown, projectId: unknown) => `/campaigns/${id(campaignId)}${query({ theme: id(projectId) })}`,
  library: (opts: { view?: 'review' } = {}) => `/library${query({ view: opts.view })}`,
  libraryItem: (assetId: unknown) => `/library/${id(assetId)}`,
  publishing: (tab?: PublishingTab) => `/publishing${query({ tab })}`,
  /** A scheduled or published copy in Publishing (?item=, so it never clashes with the post panel's ?post=). */
  publishingPost: (postId: unknown) => `/publishing${query({ item: id(postId) })}`,
  inbox: (opts: { box?: string; item?: unknown } = {}) => `/inbox${query({ box: opts.box, item: opts.item ? id(opts.item) : undefined })}`,
  blue: (chatId?: unknown) => (chatId ? `/blue/${id(chatId)}` : '/blue'),
  settings: (section?: SettingsSection) => (section ? `/settings/${section}` : '/settings'),
  user: (userId: unknown) => `/admin/users/${id(userId)}`
};

/** Full address for links that leave the app (connector results, emails). */
export function absolute(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
