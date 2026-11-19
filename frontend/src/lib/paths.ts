/**
 * Every address in the app comes from here (mirrors backend/src/lib/links.ts), so a page can move
 * without breaking links. People see "post"; the API keeps "task". Themes were retired (Post v2).
 *
 * Any page can open a post in the side panel by adding ?post=<id> (see components/posts/PostPanelHost).
 */

const id = (v: unknown): string => {
  if (v && typeof v === 'object' && '_id' in (v as any)) return String((v as any)._id);
  if (v && typeof v === 'object' && 'id' in (v as any)) return String((v as any).id);
  return String(v ?? '');
};

const query = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export type PlannerView = 'month' | 'week' | 'list';
export type PublishingTab = 'queue' | 'accounts' | 'history';
/** Settings sections (Profile, Brand, Integrations; admins also AI and Prompts). */
export type SettingsSection = 'profile' | 'brand' | 'posters' | 'integrations' | 'ai' | 'prompts';

export interface PlannerParams {
  view?: PlannerView;
  date?: string;
  /** A campaign, or "none" for posts without a campaign. */
  campaign?: unknown;
  /** One status or several ("Idea", or ["Idea", "Draft"]). */
  status?: string | string[];
  /** List view grouping (day is the default). */
  group?: 'day' | 'campaign';
}

export const paths = {
  today: () => '/',
  planner: (p: PlannerParams = {}) =>
    `/planner${query({
      view: p.view,
      date: p.date,
      campaign: p.campaign ? (p.campaign === 'none' ? 'none' : id(p.campaign)) : undefined,
      status: Array.isArray(p.status) ? p.status.join(',') : p.status,
      group: p.group
    })}`,
  /** A post on its own page. To open it beside the current page, use useOpenPost(). */
  post: (taskId: unknown) => `/posts/${id(taskId)}`,
  campaigns: () => '/campaigns',
  campaign: (campaignId: unknown) => `/campaigns/${id(campaignId)}`,
  library: (opts: { view?: 'review' | 'trash' } = {}) => `/library${query({ view: opts.view })}`,
  libraryItem: (assetId: unknown) => `/library/${id(assetId)}`,
  inbox: (opts: { box?: string; item?: unknown } = {}) => `/inbox${query({ box: opts.box, item: opts.item ? id(opts.item) : undefined })}`,
  publishing: (tab?: PublishingTab) => `/publishing${query({ tab })}`,
  /** A scheduled or published copy in Publishing (?item=, so it never clashes with the post panel's ?post=). */
  publishingPost: (postId: unknown) => `/publishing${query({ item: id(postId) })}`,
  blue: (chatId?: unknown) => (chatId ? `/blue/${id(chatId)}` : '/blue'),
  settings: (section?: SettingsSection) => (section ? `/settings/${section}` : '/settings'),
  adminUsers: () => '/admin/users',
  adminUser: (userId: unknown) => `/admin/users/${id(userId)}`,
  adminOutreach: () => '/admin/outreach'
};

/** The id of a populated reference ({ _id, name }) or a plain id. */
export const refId = (v: unknown): string | undefined => {
  const s = id(v);
  return s && s !== 'undefined' && s !== 'null' ? s : undefined;
};

/**
 * Turns an app link from the API or the connector ("http://host/tasks/1", "/tasks/1") into the
 * current address, so old links keep working: /tasks/:id → /posts/:id (/projects/:id is redirected by the router).
 */
export function appPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    let p = u.pathname;
    if (/^\/tasks\/[a-f0-9]{24}\/?$/i.test(p)) p = p.replace(/^\/tasks\//i, '/posts/');
    return p + u.search + u.hash;
  } catch {
    return null;
  }
}
