import { ApiClient } from './apiClient';
import { ToolDefinition, ToolError } from './protocol';
import { JsonSchema } from './validate';
import { links, absolute } from '../lib/links';

/**
 * Tools exposed to Claude through the MCP connector.
 *
 * Every tool calls the app's own REST API as the connected user, so permissions are identical to
 * the web app: System Admins see everything; Hybrid users only their own campaigns and what sits
 * under them; Part two users get no AI-generation tools (and the API refuses them anyway).
 *
 * Images are intentionally out of scope for this first version (text only).
 */

export interface ToolUser {
  id: string;
  email: string;
  name: string;
  role: string;
  accessMode: string;
  canUseAI: boolean;
  /** Library (Aggregator) available to this user (global switch + per-user toggle). */
  canUseLibrary: boolean;
  /** Publishing available to this user (global switch + per-user toggle). */
  canUsePublishing?: boolean;
}

export interface ToolContext {
  api: ApiClient;
  user: ToolUser;
  /** Web app base URL, used to give Claude clickable links. */
  appUrl: string;
}

type Tool = ToolDefinition<ToolContext>;

// ---------------------------------------------------------------------------
// Schema building blocks
// ---------------------------------------------------------------------------

const OBJECT_ID_PATTERN = '^[a-fA-F0-9]{24}$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})?)?$';

const CAMPAIGN_STATUSES = ['draft', 'planning', 'active', 'paused', 'completed', 'archived'];
const PROJECT_STATUSES = ['planning', 'in_progress', 'review', 'completed', 'on_hold'];
// Post (task) statuses. Scheduled / Published / Needs attention also follow Publishing automatically.
const TASK_STATUSES = ['Idea', 'Draft', 'Ready', 'Scheduled', 'Published', 'Needs attention'];
const SETTABLE_TASK_STATUSES = ['Idea', 'Draft', 'Ready', 'Published'];
const emptyTaskCounts = (): Record<string, number> => Object.fromEntries([['total', 0], ...TASK_STATUSES.map((s) => [s, 0])]);
const PROJECT_ROLES = ['project_manager', 'project_marketer', 'project_designer', 'viewer'];

const id = (what: string): JsonSchema => ({ type: 'string', pattern: OBJECT_ID_PATTERN, description: `${what} (24-character hex ID)` });
const date = (description: string, nullable = false): JsonSchema => ({
  type: nullable ? ['string', 'null'] : 'string',
  pattern: DATE_PATTERN,
  format: 'date-or-datetime',
  description: `${description} Format YYYY-MM-DD or ISO 8601 date-time.${nullable ? ' Use null to clear.' : ''}`
});
const text = (description: string, max = 20000, nullable = false): JsonSchema => ({
  type: nullable ? ['string', 'null'] : 'string',
  maxLength: max,
  description
});
const name = (description: string): JsonSchema => ({ type: 'string', minLength: 1, maxLength: 200, description });
const statusList = (values: string[], what: string): JsonSchema => ({
  type: 'array',
  items: { type: 'string', enum: values },
  minItems: 1,
  description: `Only ${what} with one of these statuses.`
});
const page: JsonSchema = { type: 'integer', minimum: 1, description: 'Page number, starting at 1. Default 1.' };
const limit = (def: number, max: number): JsonSchema => ({
  type: 'integer',
  minimum: 1,
  maximum: max,
  description: `Results per page. Default ${def}, max ${max}.`
});
const search: JsonSchema = { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive text search in names and descriptions.' };

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema & { type: 'object' } {
  return { type: 'object', properties, required, additionalProperties: false };
}

// ---------------------------------------------------------------------------
// Output shaping: compact, predictable objects with ids and links
// ---------------------------------------------------------------------------

function refId(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value._id ? String(value._id) : String(value);
}

function ref(value: any): { id: string; name?: string } | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return { id: value };
  return { id: String(value._id), ...(value.name ? { name: value.name } : {}) };
}

function person(value: any): { id: string; name: string; email?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const fullName = [value.firstName, value.lastName].filter(Boolean).join(' ').trim();
  return { id: String(value._id), name: fullName || value.email || 'Unknown', ...(value.email ? { email: value.email } : {}) };
}

function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function shapeCampaign(c: any, appUrl: string) {
  return clean({
    id: String(c._id),
    name: c.name,
    description: c.description || undefined,
    status: c.status,
    archived: Boolean(c.archived),
    start_date: c.startDate || null,
    end_date: c.endDate || null,
    goals: c.goals?.length ? c.goals : undefined,
    core_messages: c.coreMessages || undefined,
    hashtags: c.hashtags?.length ? c.hashtags : undefined,
    created_by: person(c.createdBy),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    url: absolute(appUrl, links.campaign(c._id))
  });
}

function shapeProject(p: any, appUrl: string) {
  return clean({
    id: String(p._id),
    name: p.name,
    description: p.description || undefined,
    status: p.status,
    campaign: ref(p.campaignId),
    start_date: p.startDate || null,
    due_date: p.dueDate || null,
    assignments: Array.isArray(p.assignments) && p.assignments.length
      ? p.assignments.map((a: any) => clean({ user: person(a.userId) || { id: refId(a.userId) }, role: a.role, assigned_at: a.assignedAt }))
      : undefined,
    created_by: person(p.createdBy),
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    url: absolute(appUrl, links.theme(p.campaignId, p._id))
  });
}

function shapeTask(t: any, appUrl: string) {
  return clean({
    id: String(t._id),
    name: t.name,
    description: t.description || undefined,
    status: t.status,
    task_date: t.taskDate || null,
    content: t.content || undefined,
    project: ref(t.projectId),
    campaign: ref(t.campaignId),
    designed_image_url: t.designedImage || undefined,
    attached_image_urls: t.attachedImages?.length ? t.attachedImages : undefined,
    has_pending_generated_image: t.pendingGeneratedImage ? true : undefined,
    created_by: person(t.createdBy),
    last_modified_by: person(t.lastModifiedBy),
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    url: absolute(appUrl, links.post(t._id))
  });
}

function shapeComment(c: any) {
  return clean({
    id: String(c._id),
    content: c.content,
    author: person(c.authorId),
    reply_to_comment_id: refId(c.parentCommentId),
    edited: c.isEdited ? true : undefined,
    created_at: c.createdAt,
    updated_at: c.isEdited ? c.updatedAt : undefined
  });
}

function shapeUser(u: any) {
  return clean({
    id: String(u._id || u.id),
    email: u.email,
    first_name: u.firstName,
    last_name: u.lastName,
    role: u.role,
    part: u.accessMode === 'part_two' ? 'part_two' : 'part_one',
    claude_connector_enabled: u.mcpEnabled !== false,
    blue_enabled: u.assistantEnabled !== false,
    library_enabled: u.libraryEnabled !== false,
    publishing_enabled: u.publishingEnabled !== false,
    active: u.isActive !== false,
    login_method: u.authProvider,
    campaign_count: u.campaignCount,
    created_at: u.createdAt
  });
}

function paging(p: any) {
  return p ? { total: p.total, page: p.page, per_page: p.limit, pages: p.pages } : undefined;
}

/** A date-only upper bound means "through the end of that day". */
function endOfDay(value: string | undefined): string | undefined {
  if (!value) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
}

function startOfDay(value: string | undefined): string | undefined {
  if (!value) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

/** Copy only the provided fields, mapping snake_case tool args to the API's camelCase. */
function pick(args: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(mapping)) {
    if (args[from] !== undefined) out[to] = args[from];
  }
  return out;
}

function requireSomeField(body: Record<string, unknown>, fields: string) {
  if (Object.keys(body).length === 0) throw new ToolError(`Nothing to update. Provide at least one of: ${fields}.`);
}

const isAdmin = (ctx: ToolContext) => ctx.user.role === 'system_admin';
const canUseAI = (ctx: ToolContext) => ctx.user.canUseAI;

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

const accountTools: Tool[] = [
  {
    name: 'get_my_account',
    title: 'Get my account',
    description:
      'Who you are connected as: name, email, role (system_admin sees all campaigns; hybrid sees only campaigns they created), platform part, whether AI generation is available, and the saved company/brand information. Call this first if you need context about the user or their brand.',
    inputSchema: obj({}),
    annotations: READ,
    handler: async (_args, ctx) => {
      const [me, company] = await Promise.all([
        ctx.api.request('GET', '/api/auth/me'),
        ctx.api.request('GET', '/api/users/me/company-info')
      ]);
      const u = me.user;
      return {
        id: String(u.id),
        email: u.email,
        first_name: u.firstName,
        last_name: u.lastName,
        role: u.role,
        part: u.accessMode === 'part_two' ? 'part_two' : 'part_one',
        ai_generation_available: ctx.user.canUseAI,
        company_info: company.companyInfo || {},
        app_url: ctx.appUrl
      };
    }
  },
  {
    name: 'get_company_info',
    title: 'Get company info',
    description: 'The user\'s saved company and brand information (company name, sector, about, products/services, USP, brand tone, audience profile, global rules, brand guidelines). Use it to write on-brand content.',
    inputSchema: obj({}),
    annotations: READ,
    handler: async (_args, ctx) => (await ctx.api.request('GET', '/api/users/me/company-info')).companyInfo || {}
  },
  {
    name: 'update_company_info',
    title: 'Update company info',
    description: 'Update the user\'s company and brand information. Only the fields you pass are changed; pass an empty string to clear a field.',
    inputSchema: obj({
      company_name: text('Company name.', 200),
      sector: text('Industry or sector.', 200),
      about: text('About the company.'),
      products_services: text('Products and services.'),
      usp: text('Unique selling proposition.'),
      brand_tone: text('Brand tone of voice.'),
      audience_profile: text('Target audience profile.'),
      global_rules: text('Rules every piece of content must follow.'),
      brand_guidelines: text('Brand guidelines.')
    }),
    annotations: UPDATE,
    handler: async (args, ctx) => {
      const body = pick(args, {
        company_name: 'companyName',
        sector: 'sector',
        about: 'about',
        products_services: 'productsServices',
        usp: 'usp',
        brand_tone: 'brandTone',
        audience_profile: 'audienceProfile',
        global_rules: 'globalRules',
        brand_guidelines: 'brandGuidelines'
      });
      requireSomeField(body, 'company_name, sector, about, products_services, usp, brand_tone, audience_profile, global_rules, brand_guidelines');
      const res = await ctx.api.request('PATCH', '/api/users/me/company-info', { body });
      return { message: res.message, company_info: res.companyInfo };
    }
  }
];

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const campaignFields = {
  description: text('Campaign description.', 20000, true),
  status: { type: 'string', enum: CAMPAIGN_STATUSES, description: 'Campaign status.' } as JsonSchema,
  start_date: date('Campaign start date.', true),
  end_date: date('Campaign end date.', true),
  goals: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 50, description: 'Campaign goals (replaces the whole list).' } as JsonSchema,
  core_messages: text('Core messages of the campaign.', 20000, true),
  hashtags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 100, description: 'Hashtags (replaces the whole list), e.g. ["#launch"].' } as JsonSchema
};
const campaignMapping = {
  name: 'name',
  description: 'description',
  status: 'status',
  start_date: 'startDate',
  end_date: 'endDate',
  goals: 'goals',
  core_messages: 'coreMessages',
  hashtags: 'hashtags'
};

const campaignTools: Tool[] = [
  {
    name: 'list_campaigns',
    title: 'List campaigns',
    description: 'List campaigns the user can see (newest first). Archived campaigns are excluded unless include_archived is true. Returns ids you can pass to other tools.',
    inputSchema: obj({
      search,
      status: statusList(CAMPAIGN_STATUSES, 'campaigns'),
      include_archived: { type: 'boolean', description: 'Include archived campaigns. Default false.' },
      date_from: date('Only campaigns whose start or end date is on/after this date.'),
      date_to: date('Only campaigns whose start or end date is on/before this date.'),
      created_by_user_id: { ...id('Only campaigns created by this user. System Admins only.') },
      page,
      limit: limit(25, 100)
    }),
    annotations: READ,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/campaigns', {
        query: {
          search: args.search,
          status: args.status,
          includeArchived: args.include_archived ? 'true' : undefined,
          dateFrom: startOfDay(args.date_from),
          dateTo: endOfDay(args.date_to),
          createdBy: args.created_by_user_id,
          page: args.page ?? 1,
          limit: args.limit ?? 25
        }
      });
      return { campaigns: res.campaigns.map((c: any) => shapeCampaign(c, ctx.appUrl)), pagination: paging(res.pagination) };
    }
  },
  {
    name: 'get_campaign',
    title: 'Get campaign',
    description: 'Full details of one campaign, including its themes (projects) with post counts per status.',
    inputSchema: obj({ campaign_id: id('Campaign ID.') }, ['campaign_id']),
    annotations: READ,
    handler: async (args, ctx) => {
      const [campaignRes, projectsRes, tasksRes] = await Promise.all([
        ctx.api.request('GET', `/api/campaigns/${args.campaign_id}`),
        ctx.api.request('GET', '/api/projects', { query: { campaignId: args.campaign_id, limit: 500 } }),
        ctx.api.request('GET', '/api/tasks', { query: { campaignId: args.campaign_id, limit: 5000 } })
      ]);
      const counts = new Map<string, Record<string, number>>();
      for (const t of tasksRes.tasks) {
        const pid = refId(t.projectId) || 'unknown';
        const c = counts.get(pid) || emptyTaskCounts();
        c.total += 1;
        c[t.status] = (c[t.status] || 0) + 1;
        counts.set(pid, c);
      }
      return {
        campaign: shapeCampaign(campaignRes.campaign, ctx.appUrl),
        projects: projectsRes.projects.map((p: any) => ({
          ...shapeProject(p, ctx.appUrl),
          task_counts: counts.get(String(p._id)) || emptyTaskCounts()
        })),
        total_tasks: tasksRes.tasks.length
      };
    }
  },
  {
    name: 'create_campaign',
    title: 'Create campaign',
    description: 'Create a new campaign owned by the user. Status defaults to "draft".',
    inputSchema: obj({ name: name('Campaign name.'), ...campaignFields }, ['name']),
    annotations: CREATE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', '/api/campaigns', { body: pick(args, campaignMapping) });
      return { message: res.message, campaign: shapeCampaign(res.campaign, ctx.appUrl) };
    }
  },
  {
    name: 'update_campaign',
    title: 'Update campaign',
    description: 'Change a campaign. Only the fields you pass are changed. goals and hashtags replace the existing lists.',
    inputSchema: obj({ campaign_id: id('Campaign ID.'), name: name('New campaign name.'), ...campaignFields }, ['campaign_id']),
    annotations: UPDATE,
    handler: async (args, ctx) => {
      const body = pick(args, campaignMapping);
      requireSomeField(body, Object.keys(campaignMapping).join(', '));
      const res = await ctx.api.request('PUT', `/api/campaigns/${args.campaign_id}`, { body });
      return { message: res.message, campaign: shapeCampaign(res.campaign, ctx.appUrl) };
    }
  },
  {
    name: 'archive_campaign',
    title: 'Archive campaign',
    description: 'Archive a campaign (this is what "delete" does in the app). It disappears from lists and the calendar but nothing is erased; restore_campaign brings it back. Confirm with the user first.',
    inputSchema: obj({ campaign_id: id('Campaign ID.') }, ['campaign_id']),
    annotations: DESTRUCTIVE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('PUT', `/api/campaigns/${args.campaign_id}/archive`);
      return { message: res.message, campaign: shapeCampaign(res.campaign, ctx.appUrl) };
    }
  },
  {
    name: 'restore_campaign',
    title: 'Restore campaign',
    description: 'Restore an archived campaign so it shows in the app again. Find archived campaigns with list_campaigns include_archived=true.',
    inputSchema: obj({ campaign_id: id('Campaign ID.') }, ['campaign_id']),
    annotations: UPDATE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('PUT', `/api/campaigns/${args.campaign_id}/unarchive`);
      return { message: res.message, campaign: shapeCampaign(res.campaign, ctx.appUrl) };
    }
  }
];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const projectStatus: JsonSchema = { type: 'string', enum: PROJECT_STATUSES, description: 'Project status.' };

const projectTools: Tool[] = [
  {
    name: 'list_projects',
    title: 'List themes (projects)',
    description: 'List the themes (called projects in these tools) the user can see, optionally within one campaign (newest first). A theme is a strand of a campaign, e.g. "Launch week".',
    inputSchema: obj({
      campaign_id: id('Only projects in this campaign.'),
      status: statusList(PROJECT_STATUSES, 'projects'),
      search,
      date_from: date('Only projects whose start or due date is on/after this date.'),
      date_to: date('Only projects whose start or due date is on/before this date.'),
      page,
      limit: limit(50, 200)
    }),
    annotations: READ,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/projects', {
        query: {
          campaignId: args.campaign_id,
          status: args.status,
          search: args.search,
          dateFrom: startOfDay(args.date_from),
          dateTo: endOfDay(args.date_to),
          page: args.page ?? 1,
          limit: args.limit ?? 50
        }
      });
      return { projects: res.projects.map((p: any) => shapeProject(p, ctx.appUrl)), pagination: paging(res.pagination) };
    }
  },
  {
    name: 'get_project',
    title: 'Get theme (project)',
    description: 'Full details of one theme (project) with its posts (tasks, ordered by day) and its comments.',
    inputSchema: obj({ project_id: id('Project ID.') }, ['project_id']),
    annotations: READ,
    handler: async (args, ctx) => {
      const [projectRes, tasksRes, commentsRes] = await Promise.all([
        ctx.api.request('GET', `/api/projects/${args.project_id}`),
        ctx.api.request('GET', '/api/tasks', { query: { projectId: args.project_id, limit: 1000 } }),
        ctx.api.request('GET', '/api/comments', { query: { projectId: args.project_id } })
      ]);
      return {
        project: shapeProject(projectRes.project, ctx.appUrl),
        tasks: tasksRes.tasks.map((t: any) => shapeTask(t, ctx.appUrl)),
        comments: commentsRes.comments.map(shapeComment)
      };
    }
  },
  {
    name: 'create_project',
    title: 'Create theme (project)',
    description: 'Create a theme (project) inside a campaign, e.g. "Launch week" or "Customer stories". Status defaults to "planning".',
    inputSchema: obj(
      {
        campaign_id: id('Campaign the project belongs to.'),
        name: name('Project name.'),
        description: text('Project description.'),
        status: projectStatus,
        start_date: date('Project start date.'),
        due_date: date('Project due date.')
      },
      ['campaign_id', 'name']
    ),
    annotations: CREATE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', '/api/projects', {
        body: pick(args, { campaign_id: 'campaignId', name: 'name', description: 'description', start_date: 'startDate', due_date: 'dueDate' })
      });
      let project = res.project;
      if (args.status && args.status !== 'planning') {
        const updated = await ctx.api.request('PUT', `/api/projects/${project._id}`, { body: { status: args.status } });
        project = updated.project;
      }
      return { message: res.message, project: shapeProject(project, ctx.appUrl) };
    }
  },
  {
    name: 'update_project',
    title: 'Update theme (project)',
    description: 'Change a theme (project). Only the fields you pass are changed.',
    inputSchema: obj(
      {
        project_id: id('Project ID.'),
        name: name('New project name.'),
        description: text('Project description.', 20000, true),
        status: projectStatus,
        start_date: date('Project start date.', true),
        due_date: date('Project due date.', true)
      },
      ['project_id']
    ),
    annotations: UPDATE,
    handler: async (args, ctx) => {
      const body = pick(args, { name: 'name', description: 'description', status: 'status', start_date: 'startDate', due_date: 'dueDate' });
      requireSomeField(body, 'name, description, status, start_date, due_date');
      const res = await ctx.api.request('PUT', `/api/projects/${args.project_id}`, { body });
      return { message: res.message, project: shapeProject(res.project, ctx.appUrl) };
    }
  },
  {
    name: 'assign_user_to_project',
    title: 'Assign user to project',
    description: 'Add a team member to a project with a project role. Needs the user\'s ID (System Admins can look it up with list_users).',
    inputSchema: obj(
      {
        project_id: id('Project ID.'),
        user_id: id('User to assign.'),
        role: { type: 'string', enum: PROJECT_ROLES, description: 'Role on this project.' }
      },
      ['project_id', 'user_id', 'role']
    ),
    annotations: CREATE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', `/api/projects/${args.project_id}/assignments`, {
        body: { userId: args.user_id, role: args.role }
      });
      return { message: res.message, project: shapeProject(res.project, ctx.appUrl) };
    }
  },
  {
    name: 'remove_user_from_project',
    title: 'Remove user from project',
    description: 'Remove a team member from a project.',
    inputSchema: obj({ project_id: id('Project ID.'), user_id: id('User to remove.') }, ['project_id', 'user_id']),
    annotations: DESTRUCTIVE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('DELETE', `/api/projects/${args.project_id}/assignments/${args.user_id}`);
      return { message: res.message };
    }
  }
];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskStatus: JsonSchema = {
  type: 'string',
  enum: SETTABLE_TASK_STATUSES,
  description: 'Post status: Idea, Draft, Ready, or Published (posted by hand). Scheduled and Needs attention are set by Publishing.'
};
const taskContent = text(
  'The caption: the text that gets published (with hashtags and call to action). This is what the app shows in social previews.',
  50000
);
const newTaskFields = {
  name: name('Post title (only the user sees it).'),
  description: text('The brief: what the post should achieve and show.'),
  task_date: date('The day the post goes out (places it in the Planner).'),
  content: taskContent,
  status: taskStatus
};
const taskMapping = { name: 'name', description: 'description', status: 'status', task_date: 'taskDate', content: 'content' };

const taskTools: Tool[] = [
  {
    name: 'list_tasks',
    title: 'List posts (tasks)',
    description: 'List the posts (called tasks in these tools) the user can see, ordered by day. Filter by theme (project), campaign, status, date range or text.',
    inputSchema: obj({
      project_id: id('Only tasks in this project.'),
      campaign_id: id('Only tasks in this campaign.'),
      status: statusList(TASK_STATUSES, 'tasks'),
      date_from: date('Only tasks dated on/after this date.'),
      date_to: date('Only tasks dated on/before this date (inclusive).'),
      search,
      page,
      limit: limit(50, 200)
    }),
    annotations: READ,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/tasks', {
        query: {
          projectId: args.project_id,
          campaignId: args.campaign_id,
          status: args.status,
          dateFrom: startOfDay(args.date_from),
          dateTo: endOfDay(args.date_to),
          search: args.search,
          page: args.page ?? 1,
          limit: args.limit ?? 50
        }
      });
      return { tasks: res.tasks.map((t: any) => shapeTask(t, ctx.appUrl)), pagination: paging(res.pagination) };
    }
  },
  {
    name: 'get_calendar',
    title: 'Get calendar',
    description: 'Posts (tasks) planned between two dates, grouped by day (same data as the app\'s Planner). Dates are grouped by their UTC date.',
    inputSchema: obj(
      {
        date_from: date('First day (inclusive).'),
        date_to: date('Last day (inclusive). At most 366 days after date_from.'),
        campaign_id: id('Only tasks in this campaign.'),
        project_id: id('Only tasks in this project.'),
        status: statusList(TASK_STATUSES, 'tasks')
      },
      ['date_from', 'date_to']
    ),
    annotations: READ,
    handler: async (args, ctx) => {
      const from = new Date(startOfDay(args.date_from)!);
      const to = new Date(endOfDay(args.date_to)!);
      if (to < from) throw new ToolError('date_to must be on or after date_from.');
      if (to.getTime() - from.getTime() > 367 * 24 * 3600 * 1000) throw new ToolError('The date range can be at most one year.');
      const res = await ctx.api.request('GET', '/api/tasks', {
        query: {
          dateFrom: from.toISOString(),
          dateTo: to.toISOString(),
          campaignId: args.campaign_id,
          projectId: args.project_id,
          status: args.status,
          limit: 2000
        }
      });
      const days: Record<string, any[]> = {};
      for (const t of res.tasks) {
        const key = t.taskDate ? new Date(t.taskDate).toISOString().slice(0, 10) : 'undated';
        (days[key] ||= []).push(shapeTask(t, ctx.appUrl));
      }
      return { date_from: args.date_from, date_to: args.date_to, total_tasks: res.tasks.length, days };
    }
  },
  {
    name: 'get_task',
    title: 'Get post (task)',
    description: 'Full details of one post (task): title, brief, caption (content), day, status, and its comments.',
    inputSchema: obj({ task_id: id('Task ID.') }, ['task_id']),
    annotations: READ,
    handler: async (args, ctx) => {
      const [taskRes, commentsRes] = await Promise.all([
        ctx.api.request('GET', `/api/tasks/${args.task_id}`),
        ctx.api.request('GET', '/api/comments', { query: { taskId: args.task_id } })
      ]);
      return { task: shapeTask(taskRes.task, ctx.appUrl), comments: commentsRes.comments.map(shapeComment) };
    }
  },
  {
    name: 'create_task',
    title: 'Create post (task)',
    description: 'Create a post (task) in a theme (project). Put the brief in "description" and the finished caption in "content". Status defaults to "Draft".',
    inputSchema: obj({ project_id: id('Project the task belongs to.'), ...newTaskFields }, ['project_id', 'name']),
    annotations: CREATE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', '/api/tasks', {
        body: { projectId: args.project_id, ...pick(args, taskMapping) }
      });
      return { message: res.message, task: shapeTask(res.task, ctx.appUrl) };
    }
  },
  {
    name: 'create_tasks',
    title: 'Create several posts (tasks)',
    description: 'Create up to 50 posts (tasks) in one theme (project) in one go (e.g. a month of content). Each is created separately; the result lists which succeeded.',
    inputSchema: obj(
      {
        project_id: id('Project the tasks belong to.'),
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: obj(newTaskFields, ['name']),
          description: 'Tasks to create.'
        }
      },
      ['project_id', 'tasks']
    ),
    annotations: CREATE,
    handler: async (args, ctx) => {
      // Created a few at a time (not one by one) so large calendars don't take minutes on a slow
      // database connection, while keeping the order of results.
      const results: any[] = new Array(args.tasks.length);
      let stop = false;
      const createOne = async (i: number) => {
        if (stop) {
          results[i] = { index: i, created: false, name: args.tasks[i].name, error: 'Skipped after an earlier access error' };
          return;
        }
        try {
          const res = await ctx.api.request('POST', '/api/tasks', {
            body: { projectId: args.project_id, ...pick(args.tasks[i], taskMapping) }
          });
          results[i] = { index: i, created: true, task: shapeTask(res.task, ctx.appUrl) };
        } catch (error: any) {
          results[i] = { index: i, created: false, name: args.tasks[i].name, error: error?.message || String(error) };
          // Stop early on errors that will repeat for every task (no access / project gone).
          if (error?.status === 401 || error?.status === 403 || error?.status === 404) stop = true;
        }
      };
      const CONCURRENCY = 4;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, args.tasks.length) }, async () => {
          while (next < args.tasks.length) await createOne(next++);
        })
      );
      const created = results.filter((r) => r.created).length;
      return { message: `Created ${created} of ${args.tasks.length} task(s)`, results };
    }
  },
  {
    name: 'update_task',
    title: 'Update post (task)',
    description: 'Change a post (task): title, brief (description), status, day, caption (content), or move it to another theme with project_id. Only the fields you pass are changed. A post that is Scheduled or Needs attention can\'t change status until it\'s cancelled or fixed in Publishing.',
    inputSchema: obj(
      {
        task_id: id('Post (task) ID.'),
        project_id: id('Move the post to this theme (project), in this or another of the user\'s campaigns.'),
        name: name('New post title.'),
        description: text('The brief.', 20000, true),
        status: taskStatus,
        task_date: date('Task date.', true),
        content: { ...taskContent, type: ['string', 'null'] }
      },
      ['task_id']
    ),
    annotations: UPDATE,
    handler: async (args, ctx) => {
      const body = { ...pick(args, taskMapping), ...(args.project_id ? { projectId: args.project_id } : {}) };
      requireSomeField(body, 'name, description, status, task_date, content, project_id');
      const res = await ctx.api.request('PUT', `/api/tasks/${args.task_id}`, { body });
      return { message: res.message, task: shapeTask(res.task, ctx.appUrl) };
    }
  },
  {
    name: 'delete_task',
    title: 'Delete post (task)',
    description: 'Permanently delete a post (task) and its comments; anything scheduled for it is cancelled. This cannot be undone, so confirm with the user first.',
    inputSchema: obj({ task_id: id('Task ID.') }, ['task_id']),
    annotations: DESTRUCTIVE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('DELETE', `/api/tasks/${args.task_id}`);
      return { message: res.message };
    }
  }
];

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const targetType: JsonSchema = { type: 'string', enum: ['campaign', 'project', 'task'], description: 'What the comment is attached to.' };
const targetParam: Record<string, string> = { campaign: 'campaignId', project: 'projectId', task: 'taskId' };

const commentTools: Tool[] = [
  {
    name: 'list_comments',
    title: 'List comments',
    description: 'Comments on a campaign, theme (project) or post (task), newest first.',
    inputSchema: obj({ target_type: targetType, target_id: id('ID of the campaign, project or task.') }, ['target_type', 'target_id']),
    annotations: READ,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/comments', { query: { [targetParam[args.target_type]]: args.target_id } });
      return { comments: res.comments.map(shapeComment) };
    }
  },
  {
    name: 'add_comment',
    title: 'Add comment',
    description: 'Add a comment on a campaign, theme (project) or post (task), as the user. Optionally reply to another comment.',
    inputSchema: obj(
      {
        target_type: targetType,
        target_id: id('ID of the campaign, project or task.'),
        content: { type: 'string', minLength: 1, maxLength: 10000, description: 'Comment text.' },
        reply_to_comment_id: id('Comment being replied to.')
      },
      ['target_type', 'target_id', 'content']
    ),
    annotations: CREATE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', '/api/comments', {
        body: {
          content: args.content,
          [targetParam[args.target_type]]: args.target_id,
          ...(args.reply_to_comment_id ? { parentCommentId: args.reply_to_comment_id } : {})
        }
      });
      return { message: res.message, comment: shapeComment(res.comment) };
    }
  },
  {
    name: 'update_comment',
    title: 'Edit comment',
    description: 'Edit a comment. Only its author (or a System Admin) can edit it.',
    inputSchema: obj(
      { comment_id: id('Comment ID.'), content: { type: 'string', minLength: 1, maxLength: 10000, description: 'New comment text.' } },
      ['comment_id', 'content']
    ),
    annotations: UPDATE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('PUT', `/api/comments/${args.comment_id}`, { body: { content: args.content } });
      return { message: res.message, comment: shapeComment(res.comment) };
    }
  },
  {
    name: 'delete_comment',
    title: 'Delete comment',
    description: 'Permanently delete a comment. Only its author (or a System Admin) can delete it. Confirm with the user first.',
    inputSchema: obj({ comment_id: id('Comment ID.') }, ['comment_id']),
    annotations: DESTRUCTIVE,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('DELETE', `/api/comments/${args.comment_id}`);
      return { message: res.message };
    }
  }
];

// ---------------------------------------------------------------------------
// AI generation through the app (Part one users and System Admins only)
// ---------------------------------------------------------------------------

const aiTools: Tool[] = [
  {
    name: 'generate_campaign_content',
    title: 'Plan a campaign with the app AI',
    description:
      'Run the app\'s Plan with AI on a campaign: it drafts themes and posts (titles, briefs, captions, days) with the brand and campaign details and creates them straight away. In the app people review the draft first, so only use this when the user explicitly asks for the app\'s own AI planning; otherwise plan the posts yourself with create_project / create_tasks. Confirm the period with the user first.',
    inputSchema: obj(
      {
        campaign_id: id('Campaign ID.'),
        notes: text('What the posts should focus on (optional).', 2000),
        date_from: date('First day to plan (default: the campaign start, or today if it already started).'),
        date_to: date('Last day to plan (default: the campaign end, or four weeks).'),
        posts_per_week: { type: 'integer', minimum: 1, maximum: 14, description: 'About how many posts a week (optional).' },
        command: { type: 'string', minLength: 1, maxLength: 200, description: 'Only if the user names one: an AI command set up by the administrator. Leave out to use the standard plan.' }
      },
      ['campaign_id']
    ),
    annotations: CREATE,
    isAvailable: canUseAI,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', `/api/campaigns/${args.campaign_id}/generate`, {
        body: { command: args.command, notes: args.notes, from: args.date_from, to: args.date_to, perWeek: args.posts_per_week },
        timeoutMs: 240000
      });
      return {
        message: res.message,
        themes: (res.projects || []).map((p: any, i: number) => ({ ...shapeProject(p, ctx.appUrl), posts_created: res.taskCounts?.[i] }))
      };
    }
  },
  {
    name: 'refine_task_description',
    title: 'Improve a post\'s brief (app AI)',
    description: 'Ask the app\'s AI to rewrite a post\'s brief (the task description). Returns a suggestion only; nothing is saved until you call update_task.',
    inputSchema: obj({ task_id: id('Task ID.') }, ['task_id']),
    annotations: READ,
    isAvailable: canUseAI,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', `/api/tasks/${args.task_id}/refine-description`, { timeoutMs: 120000 });
      return { original_description: res.originalDescription, suggested_description: res.refinedDescription };
    }
  },
  {
    name: 'improve_caption',
    title: 'Improve a post\'s caption (app AI)',
    description:
      'Ask the app\'s AI to improve a post\'s caption, the same as "Improve caption" in the app. Styles: improve (default), shorter, playful, professional, fix (spelling only), cta (add a call to action), hashtags, x / linkedin / instagram (fit that platform), write (when there\'s no caption yet). Returns a suggestion only; save it with update_task (content) after the user agrees.',
    inputSchema: obj(
      {
        task_id: id('Post (task) ID.'),
        style: { type: 'string', enum: ['improve', 'shorter', 'playful', 'professional', 'fix', 'cta', 'hashtags', 'x', 'linkedin', 'instagram', 'write'], description: 'How to change it.' }
      },
      ['task_id']
    ),
    annotations: READ,
    isAvailable: canUseAI,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', `/api/tasks/${args.task_id}/improve-caption`, { body: { style: args.style || 'improve' }, timeoutMs: 120000 });
      return { original_caption: res.original, suggested_caption: res.suggestion, style: res.label };
    }
  }
];

// ---------------------------------------------------------------------------
// Administration (System Admins only)
// ---------------------------------------------------------------------------

const userRole: JsonSchema = { type: 'string', enum: ['system_admin', 'hybrid'], description: 'system_admin sees and manages everything; hybrid manages only their own campaigns.' };
const userPart: JsonSchema = { type: 'string', enum: ['part_one', 'part_two'], description: 'part_one: AI generation enabled; part_two: AI generation off.' };

const adminTools: Tool[] = [
  {
    name: 'list_users',
    title: 'List users',
    description: 'List active user accounts (System Admins only).',
    inputSchema: obj({ page, limit: limit(50, 200) }),
    annotations: READ,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/users', { query: { page: args.page ?? 1, limit: args.limit ?? 50 } });
      return { users: res.users.map(shapeUser), pagination: paging(res.pagination) };
    }
  },
  {
    name: 'get_user',
    title: 'Get user',
    description: 'Details of one user account (System Admins only).',
    inputSchema: obj({ user_id: id('User ID.') }, ['user_id']),
    annotations: READ,
    isAvailable: isAdmin,
    handler: async (args, ctx) => shapeUser((await ctx.api.request('GET', `/api/users/${args.user_id}`)).user)
  },
  {
    name: 'create_user',
    title: 'Create user',
    description: 'Create a user account with email and password (System Admins only).',
    inputSchema: obj(
      {
        email: { type: 'string', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', maxLength: 254, description: 'Email address.' },
        password: { type: 'string', minLength: 6, maxLength: 200, description: 'Initial password (at least 6 characters).' },
        first_name: name('First name.'),
        last_name: name('Last name.'),
        role: userRole,
        part: userPart,
        claude_connector_enabled: { type: 'boolean', description: 'Allow this user to connect Claude. Default true.' },
        blue_enabled: { type: 'boolean', description: 'Allow this user to use Blue, the in-app assistant. Default true.' },
        library_enabled: { type: 'boolean', description: 'Allow this user to use the Library (Aggregator). Default true.' },
        publishing_enabled: { type: 'boolean', description: 'Allow this user to schedule and publish posts. Default true.' }
      },
      ['email', 'password', 'first_name', 'last_name', 'role']
    ),
    annotations: CREATE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', '/api/users', {
        body: pick(args, {
          email: 'email',
          password: 'password',
          first_name: 'firstName',
          last_name: 'lastName',
          role: 'role',
          part: 'accessMode',
          claude_connector_enabled: 'mcpEnabled',
          blue_enabled: 'assistantEnabled',
          library_enabled: 'libraryEnabled',
          publishing_enabled: 'publishingEnabled'
        })
      });
      return { message: res.message, user: shapeUser(res.user) };
    }
  },
  {
    name: 'update_user',
    title: 'Update user',
    description: 'Change a user account: name, email, role, platform part, Claude connector access, Blue access, or reactivate it (System Admins only). Turning the connector off disconnects that user\'s Claude immediately.',
    inputSchema: obj(
      {
        user_id: id('User ID.'),
        email: { type: 'string', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', maxLength: 254, description: 'New email address.' },
        first_name: name('First name.'),
        last_name: name('Last name.'),
        role: userRole,
        part: userPart,
        claude_connector_enabled: { type: 'boolean', description: 'Allow this user to connect Claude.' },
        blue_enabled: { type: 'boolean', description: 'Allow this user to use Blue, the in-app assistant.' },
        library_enabled: { type: 'boolean', description: 'Allow this user to use the Library (Aggregator).' },
        publishing_enabled: { type: 'boolean', description: 'Allow this user to schedule and publish posts.' },
        active: { type: 'boolean', description: 'false deactivates the account, true reactivates it.' }
      },
      ['user_id']
    ),
    annotations: UPDATE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      const body = pick(args, {
        email: 'email',
        first_name: 'firstName',
        last_name: 'lastName',
        role: 'role',
        part: 'accessMode',
        claude_connector_enabled: 'mcpEnabled',
        blue_enabled: 'assistantEnabled',
        library_enabled: 'libraryEnabled',
        publishing_enabled: 'publishingEnabled',
        active: 'isActive'
      });
      requireSomeField(body, 'email, first_name, last_name, role, part, claude_connector_enabled, blue_enabled, library_enabled, publishing_enabled, active');
      const res = await ctx.api.request('PUT', `/api/users/${args.user_id}`, { body });
      return { message: res.message, user: shapeUser(res.user) };
    }
  },
  {
    name: 'deactivate_user',
    title: 'Deactivate user',
    description: 'Deactivate a user account (this is what "delete" does in the app): they can no longer sign in or use Claude. Their data is kept and update_user active=true restores access. Confirm with the user first.',
    inputSchema: obj({ user_id: id('User ID.') }, ['user_id']),
    annotations: DESTRUCTIVE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      if (args.user_id === ctx.user.id) throw new ToolError('You cannot deactivate your own account from Claude.');
      const res = await ctx.api.request('DELETE', `/api/users/${args.user_id}`);
      return { message: res.message };
    }
  }
];


// ---------------------------------------------------------------------------
// Library (Aggregator): the user's past and present work, with versions
// ---------------------------------------------------------------------------

const LIBRARY_KINDS = ['image', 'video', 'audio', 'document', 'text', 'design', 'other'];
const LIBRARY_CATEGORIES = ['poster', 'social_post', 'photo', 'logo', 'illustration', 'screenshot', 'document', 'caption', 'draft', 'video', 'other'];

function shapeLibraryItem(i: any, appUrl: string, detail = false) {
  const text = detail ? i.textContent : i.textPreview;
  return clean({
    id: i.id,
    title: i.title,
    kind: i.kind,
    category: i.category,
    date: i.capturedAt ? String(i.capturedAt).slice(0, 10) : undefined,
    date_source: i.dateSource,
    event: i.event || undefined,
    tags: i.tags?.length ? i.tags : undefined,
    description: i.description || undefined,
    text: text ? String(text).slice(0, detail ? 3000 : 280) : undefined,
    notes: detail && i.notes ? i.notes : undefined,
    folder: i.folder || undefined,
    versions: i.versionCount,
    current_version: i.currentVersion?.number,
    file: i.currentVersion
      ? clean({
          name: i.currentVersion.originalName,
          type: i.currentVersion.mime,
          size_kb: Math.round((i.currentVersion.size || 0) / 1024),
          width: i.currentVersion.width,
          height: i.currentVersion.height
        })
      : undefined,
    linked_campaign_id: i.links?.campaignId || undefined,
    linked_project_id: i.links?.projectId || undefined,
    linked_task_id: i.links?.taskId || undefined,
    needs_review: i.needsReview || undefined,
    ai_status: i.aiStatus !== 'done' ? i.aiStatus : undefined,
    in_trash: i.deletedAt ? true : undefined,
    url: absolute(appUrl, links.libraryItem(i.id)),
    thumbnail_url: i.thumbnailUrl || undefined
  });
}

const canUseLibraryTools = (ctx: ToolContext) => ctx.user.canUseLibrary;

const libraryTools: Tool[] = [
  {
    name: 'library_overview',
    title: 'Library overview',
    description:
      "The table of contents of the user's Library (their uploaded past work: posters, photos, captions, logos, documents, videos): totals by type, and years → months → events with item counts. Call this first when looking for something, so you know which dates and events exist before searching.",
    inputSchema: obj({}),
    annotations: READ,
    isAvailable: canUseLibraryTools,
    handler: async (_args, ctx) => {
      const o = (await ctx.api.request('GET', '/api/library/overview')).overview;
      return {
        total_items: o.total,
        by_type: o.kinds,
        needs_review: o.needsReview,
        being_processed: o.processing,
        in_trash: o.inTrash,
        top_events: o.topEvents,
        timeline: o.years.map((y: any) => ({
          year: y.year,
          items: y.count,
          months: y.months.map((m: any) => clean({ month: m.name, items: m.count, events: m.events.length ? m.events : undefined }))
        }))
      };
    }
  },
  {
    name: 'search_library',
    title: 'Search Library',
    description:
      'Find items in the Library by words (searches titles, AI descriptions, text inside images, captions, tags, events, file and folder names) and/or filters. For "two years ago" or "around March" convert to a date range (e.g. a whole month, or ±3 weeks). Results are shown to the user as an image gallery.',
    inputSchema: obj({
      query: { type: 'string', maxLength: 200, description: 'Words to search for, e.g. "women\'s day poster pink".' },
      kind: { type: 'string', enum: LIBRARY_KINDS, description: 'Type of file.' },
      category: { type: 'string', enum: LIBRARY_CATEGORIES, description: 'What the item is.' },
      event: { type: 'string', maxLength: 120, description: 'Exact event name as shown in library_overview.' },
      tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 10, description: 'Items must have all these tags.' },
      date_from: date('Only items dated on/after this day.'),
      date_to: date('Only items dated on/before this day (inclusive).'),
      linked_campaign_id: id('Only items linked to this campaign.'),
      linked_task_id: id('Only items linked to this task.'),
      needs_review: { type: 'boolean', description: 'Only items waiting for review (possible duplicates/versions).' },
      in_trash: { type: 'boolean', description: 'Search the trash instead.' },
      sort: { type: 'string', enum: ['newest', 'oldest'], description: 'Order when there is no query (default newest).' },
      page,
      limit: limit(12, 50)
    }),
    annotations: READ,
    isAvailable: canUseLibraryTools,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/library/items', {
        query: {
          q: args.query,
          kind: args.kind,
          category: args.category,
          event: args.event,
          tags: args.tags,
          from: args.date_from ? String(args.date_from).slice(0, 10) : undefined,
          to: args.date_to ? String(args.date_to).slice(0, 10) : undefined,
          campaignId: args.linked_campaign_id,
          taskId: args.linked_task_id,
          needsReview: args.needs_review ? 'true' : undefined,
          trash: args.in_trash ? 'true' : undefined,
          sort: args.sort,
          page: args.page ?? 1,
          limit: args.limit ?? 12
        }
      });
      return {
        items: res.items.map((i: any) => shapeLibraryItem(i, ctx.appUrl)),
        total_matches: res.total,
        page: res.page,
        per_page: res.limit
      };
    }
  },
  {
    name: 'get_library_item',
    title: 'Get Library item',
    description: 'Full details of one Library item: description, all text inside it, tags, links, and its version history (newest first).',
    inputSchema: obj({ item_id: id('Library item ID.') }, ['item_id']),
    annotations: READ,
    isAvailable: canUseLibraryTools,
    handler: async (args, ctx) => {
      const item = (await ctx.api.request('GET', `/api/library/items/${args.item_id}`)).item;
      return {
        item: shapeLibraryItem(item, ctx.appUrl, true),
        versions: item.versions.map((v: any) =>
          clean({
            number: v.number,
            current: v.isCurrent || undefined,
            added: String(v.createdAt).slice(0, 10),
            note: v.note || undefined,
            source: v.source,
            file: v.originalName
          })
        )
      };
    }
  },
  {
    name: 'update_library_item',
    title: 'Update Library item',
    description: 'Fix or enrich a Library item: title, description, event, tags (replaces the list), notes, date, or link it to a task, project or campaign (one link; null to unlink).',
    inputSchema: obj(
      {
        item_id: id('Library item ID.'),
        title: name('New title.'),
        description: text('Description.', 2000),
        event: { type: 'string', maxLength: 120, description: 'Event or occasion, e.g. "Women\'s Day". Empty string to clear.' },
        tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 30, description: 'Tags (replaces the list).' },
        notes: text('Notes.', 5000),
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The date the item is from, YYYY-MM-DD.' },
        link_task_id: { type: ['string', 'null'], pattern: OBJECT_ID_PATTERN, description: 'Link to this task (its project and campaign are linked too). null to unlink.' },
        link_project_id: { type: 'string', pattern: OBJECT_ID_PATTERN, description: 'Link to this project.' },
        link_campaign_id: { type: 'string', pattern: OBJECT_ID_PATTERN, description: 'Link to this campaign.' }
      },
      ['item_id']
    ),
    annotations: UPDATE,
    isAvailable: canUseLibraryTools,
    handler: async (args, ctx) => {
      const body: Record<string, unknown> = pick(args, { title: 'title', description: 'description', event: 'event', tags: 'tags', notes: 'notes', date: 'capturedAt' });
      if (args.link_task_id === null) body.links = {};
      else if (args.link_task_id) body.links = { taskId: args.link_task_id };
      else if (args.link_project_id) body.links = { projectId: args.link_project_id };
      else if (args.link_campaign_id) body.links = { campaignId: args.link_campaign_id };
      requireSomeField(body, 'title, description, event, tags, notes, date, link_task_id, link_project_id, link_campaign_id');
      const res = await ctx.api.request('PATCH', `/api/library/items/${args.item_id}`, { body });
      return { message: 'Saved', item: shapeLibraryItem(res.item, ctx.appUrl) };
    }
  },
  {
    name: 'restore_library_version',
    title: 'Restore a version',
    description: 'Make an older version of a Library item the current one again. History is kept: the restore is added as a new version.',
    inputSchema: obj(
      { item_id: id('Library item ID.'), version_number: { type: 'integer', minimum: 1, description: 'The version number to bring back.' } },
      ['item_id', 'version_number']
    ),
    annotations: UPDATE,
    isAvailable: canUseLibraryTools,
    handler: async (args, ctx) => {
      const item = (await ctx.api.request('GET', `/api/library/items/${args.item_id}`)).item;
      const version = item.versions.find((v: any) => v.number === args.version_number);
      if (!version) throw new ToolError(`Version ${args.version_number} doesn't exist; this item has versions ${item.versions.map((v: any) => v.number).join(', ')}.`);
      const res = await ctx.api.request('POST', `/api/library/items/${args.item_id}/versions/${version.id}/restore`);
      return { message: `Version ${args.version_number} is current again`, item: shapeLibraryItem(res.item, ctx.appUrl) };
    }
  },
  {
    name: 'delete_library_item',
    title: 'Delete Library item',
    description: 'Move a Library item (with all its versions) to the trash. It can be restored for 30 days, then it is deleted for good.',
    inputSchema: obj({ item_id: id('Library item ID.') }, ['item_id']),
    annotations: DESTRUCTIVE,
    isAvailable: canUseLibraryTools,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('DELETE', `/api/library/items/${args.item_id}`);
      return { message: res.message };
    }
  }
];

// ---------------------------------------------------------------------------
// Publishing: connected accounts and posts
// ---------------------------------------------------------------------------

const PLATFORM_IDS = ['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'];
/** Posting to real accounts can't be undone, so assistants ask the user first. */
const PUBLISH = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const canUsePublishingTools = (ctx: ToolContext) => ctx.user.canUsePublishing;

function shapePublishPost(p: any, appUrl: string) {
  return clean({
    id: p.id,
    platform: p.platformName,
    account: p.channel?.name || (p.mode === 'manual' ? 'post by hand' : undefined),
    status: p.status,
    when: p.scheduledAt || undefined,
    published_at: p.publishedAt || undefined,
    link: p.remoteUrl || undefined,
    task: p.task?.name ? { id: p.task.id, name: p.task.name } : undefined,
    caption: p.text ? String(p.text).slice(0, 200) : undefined,
    files: p.media?.length || undefined,
    problem: p.lastError || undefined,
    test_account: p.channel?.simulated || undefined,
    url: absolute(appUrl, links.publishingPost(p.id))
  });
}

const publishingTools: Tool[] = [
  {
    name: 'list_publishing_channels',
    title: 'List connected accounts',
    description:
      'The social accounts the user can publish to (with their ids), and which platforms the administrator has switched on. Posts for a task go to the accounts of the campaign owner. Platforms without connected accounts can still be used as "post by hand" reminders.',
    inputSchema: obj({}),
    annotations: READ,
    isAvailable: canUsePublishingTools,
    handler: async (_args, ctx) => {
      const [channels, status] = await Promise.all([ctx.api.request('GET', '/api/publishing/channels'), ctx.api.request('GET', '/api/publishing/status')]);
      return {
        accounts: channels.channels.map((c: any) => clean({ id: c.id, platform: c.platformName, name: c.name, username: c.username || undefined, test_account: c.simulated || undefined, needs_reconnect: c.status !== 'active' || undefined })),
        platforms_switched_on: status.platforms.filter((p: any) => p.ready).map((p: any) => p.name),
        test_mode: status.testMode,
        connect_more_at: absolute(ctx.appUrl, links.publishing('accounts'))
      };
    }
  },
  {
    name: 'schedule_post',
    title: 'Schedule or publish a post',
    description:
      "Publish a task's caption and image to connected accounts now or at a set time, and/or add 'post by hand' reminders for platforms without a connection. The caption defaults to the task's content. Always confirm the accounts, caption and time with the user first: posts to real accounts are public.",
    inputSchema: obj(
      {
        task_id: id('The task to publish.'),
        account_ids: { type: 'array', items: { type: 'string', pattern: OBJECT_ID_PATTERN }, maxItems: 20, description: 'Connected account ids from list_publishing_channels.' },
        post_by_hand_on: { type: 'array', items: { type: 'string', enum: PLATFORM_IDS }, maxItems: 6, description: 'Platforms to remind the user to post on by hand.' },
        when: { type: 'string', enum: ['now', 'schedule'], description: 'Post now, or at scheduled_at.' },
        scheduled_at: { type: 'string', format: 'date-or-datetime', description: 'ISO date-time with timezone, e.g. 2026-11-27T09:00:00+03:00. Required when when=schedule.' },
        caption: text('Caption to post instead of the task content.', 63000),
        include_task_image: { type: 'boolean', description: "Attach the task's image (default true)." },
        youtube_title: { type: 'string', maxLength: 100, description: 'Title for YouTube posts.' },
        tiktok_privacy: { type: 'string', enum: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], description: 'Who can see a TikTok post; ask the user.' }
      },
      ['task_id', 'when']
    ),
    annotations: PUBLISH,
    isAvailable: canUsePublishingTools,
    handler: async (args, ctx) => {
      const accounts = (args.account_ids as string[]) || [];
      const manual = (args.post_by_hand_on as string[]) || [];
      if (!accounts.length && !manual.length) throw new ToolError('Choose at least one account (account_ids) or platform to post by hand (post_by_hand_on).');
      if (args.when === 'schedule' && !args.scheduled_at) throw new ToolError('scheduled_at is required when when=schedule.');
      const info = await ctx.api.request('GET', `/api/publishing/tasks/${args.task_id}/media`);
      const caption = typeof args.caption === 'string' ? args.caption : info.task.content || '';
      const main = info.media.find((m: any) => m.isMain);
      const media = args.include_task_image === false || !main ? [] : [{ source: main.source, url: main.url, assetId: main.assetId }];
      const res = await ctx.api.request('POST', '/api/publishing/posts', {
        body: {
          taskId: args.task_id,
          text: caption,
          media,
          targets: [...accounts.map((channelId) => ({ channelId })), ...manual.map((platform) => ({ platform }))],
          when: args.when,
          scheduledAt: args.scheduled_at,
          options: {
            ...(args.youtube_title ? { youtube: { title: args.youtube_title } } : {}),
            ...(args.tiktok_privacy ? { tiktok: { privacy: args.tiktok_privacy } } : {})
          }
        }
      });
      return { message: args.when === 'now' ? 'Publishing now' : 'Scheduled', posts: res.posts.map((p: any) => shapePublishPost(p, ctx.appUrl)) };
    }
  },
  {
    name: 'list_posts',
    title: 'List posts',
    description: 'Scheduled, published, failed and post-by-hand items, newest first (upcoming: soonest first).',
    inputSchema: obj({
      status: { type: 'string', enum: ['upcoming', 'attention', 'done', 'draft', 'cancelled'], description: 'upcoming = scheduled/being published; attention = failed or due to post by hand; done = published.' },
      task_id: id('Only posts of this task.'),
      date_from: date('Scheduled on/after this day.'),
      date_to: date('Scheduled on/before this day.'),
      page,
      limit: limit(20, 50)
    }),
    annotations: READ,
    isAvailable: canUsePublishingTools,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/publishing/posts', {
        query: {
          status: args.status,
          taskId: args.task_id,
          from: args.date_from ? String(args.date_from).slice(0, 10) : undefined,
          to: args.date_to ? String(args.date_to).slice(0, 10) : undefined,
          page: args.page ?? 1,
          limit: args.limit ?? 20
        }
      });
      return { posts: res.posts.map((p: any) => shapePublishPost(p, ctx.appUrl)), total: res.total, page: res.page };
    }
  },
  {
    name: 'cancel_post',
    title: 'Cancel a scheduled post',
    description: 'Stop a scheduled (or failed / post-by-hand) post from going out. Published posts must be deleted on the platform itself.',
    inputSchema: obj({ post_id: id('Post id from list_posts.') }, ['post_id']),
    annotations: DESTRUCTIVE,
    isAvailable: canUsePublishingTools,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', `/api/publishing/posts/${args.post_id}/cancel`);
      return { message: 'Cancelled', post: shapePublishPost(res.post, ctx.appUrl) };
    }
  }
];

// ---------------------------------------------------------------------------
// Inbox: reminders and messages that need the user
// ---------------------------------------------------------------------------

const inboxTools: Tool[] = [
  {
    name: 'list_inbox',
    title: 'Check the Inbox',
    description:
      "What needs the user's attention: reminders that need a decision (posts due by hand, failed posts, accounts to reconnect, Library reviews), unread updates (upcoming posts, messages from the Blueprint team) and unread conversations. Each item lists the actions it accepts.",
    inputSchema: obj({ box: { type: 'string', enum: ['action', 'update', 'message'], description: 'Only one box. Default: needs action + unread updates.' } }),
    annotations: READ,
    handler: async (args, ctx) => {
      const boxes = args.box ? [args.box as string] : ['action', 'update'];
      const [summary, ...lists] = await Promise.all([
        ctx.api.request('GET', '/api/inbox/summary'),
        ...boxes.map((box) => ctx.api.request('GET', '/api/inbox/items', { query: { box, limit: 20 } }))
      ]);
      const items = lists.flatMap((l: any) => l.items).filter((i: any) => args.box || i.box === 'action' || !i.read);
      return {
        counts: { needs_action: summary.action, unread_updates: summary.updates, unread_messages: summary.messages },
        items: items.map((i: any) =>
          clean({
            id: i.id,
            box: i.box,
            title: i.title,
            text: i.body ? String(i.body).slice(0, 300) : undefined,
            from: i.fromName,
            actions: i.actions?.filter((a: any) => !a.link).map((a: any) => clean({ id: a.id, label: a.label, needs_value: a.input ? a.input.label : undefined })),
            open_in_app: absolute(ctx.appUrl, links.inbox({ box: i.box, item: i.id }))
          })
        )
      };
    }
  },
  {
    name: 'inbox_action',
    title: 'Act on an Inbox item',
    description:
      'Run one of the actions an Inbox item offers (e.g. publish_now, mark_posted with the live link as value, retry, cancel_post, keep, snooze, dismiss). Confirm with the user first: some actions publish publicly.',
    inputSchema: obj(
      {
        item_id: id('Inbox item id from list_inbox.'),
        action: { type: 'string', minLength: 1, maxLength: 40, description: 'Action id from the item, or "dismiss" / "snooze".' },
        value: { type: 'string', maxLength: 500, description: 'Extra value some actions take (the live post link for mark_posted; hours for snooze).' }
      },
      ['item_id', 'action']
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', `/api/inbox/items/${args.item_id}/actions/${encodeURIComponent(String(args.action))}`, { body: { value: args.value } });
      return { message: res.message };
    }
  }
];

// ---------------------------------------------------------------------------
// AI setup (System Admin): prompts, commands, connection test, usage, posters
// ---------------------------------------------------------------------------

/** The commands the app's buttons call. */
const APP_COMMANDS: Record<string, string> = {
  'generate-campaign': 'Generate Campaign button: must return a JSON array of projects with tasks',
  'refine-task-description': 'Refine button on a task: returns the improved description as plain text',
  'generate-poster': 'Generate Poster with AI on a task: an image prompt (gpt-image-1.5)'
};

const PROVIDERS = ['openai', 'anthropic', 'grok', 'gemini'];

function shapePrompt(p: any, full = false) {
  return clean({
    id: String(p._id),
    name: p.name,
    makes_image: Boolean(p.imageLLMProvider || p.imageLLMModel) || undefined,
    provider: p.llmProvider || undefined,
    model: p.llmModel || undefined,
    text: full ? p.details : String(p.details || '').slice(0, 300) + (String(p.details || '').length > 300 ? '…' : ''),
    updated: p.updatedAt ? String(p.updatedAt).slice(0, 10) : undefined
  });
}

function shapeMapping(m: any) {
  return clean({
    id: String(m._id),
    command: m.command,
    used_by: APP_COMMANDS[m.command],
    prompt: m.promptId ? { id: String(m.promptId._id || m.promptId), name: m.promptId.name } : undefined,
    chain: m.chainId ? { id: String(m.chainId._id || m.chainId), name: m.chainId.name, steps: m.chainId.steps?.length } : undefined,
    steps: m.steps?.length ? m.steps.length : undefined
  });
}

const aiAdminTools: Tool[] = [
  {
    name: 'ai_setup_status',
    title: 'AI setup status',
    description:
      "System Admin: which AI providers have API keys, every prompt, every command mapping, and which of the app's own commands (generate-campaign, refine-task-description, generate-poster) are still missing.",
    inputSchema: obj({}),
    annotations: READ,
    isAvailable: isAdmin,
    handler: async (_args, ctx) => {
      const [status, prompts, mappings] = await Promise.all([
        ctx.api.request('GET', '/api/integrations/status'),
        ctx.api.request('GET', '/api/prompts'),
        ctx.api.request('GET', '/api/command-mappings')
      ]);
      const i = status.integrations || {};
      const configured = new Set((mappings.mappings || []).map((m: any) => m.command));
      return {
        api_keys: Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(i[p]?.configured)])),
        prompts: (prompts.prompts || []).map((p: any) => shapePrompt(p)),
        commands: (mappings.mappings || []).map(shapeMapping),
        app_commands_missing: Object.keys(APP_COMMANDS).filter((c) => !configured.has(c)).map((c) => ({ command: c, used_by: APP_COMMANDS[c] })),
        placeholders:
          'Prompts can use {companyInfo} {companyName} {sector} {brandTone} {brandGuidelines} {campaignDetails} {campaignName} {coreMessages} {hashtags} {taskName} {taskDescription} {taskContent} {baseImage} {primaryLogo} {previousOutput}; unknown or empty ones are removed before sending.'
      };
    }
  },
  {
    name: 'get_prompt',
    title: 'Get prompt',
    description: 'System Admin: the full text and settings of one prompt.',
    inputSchema: obj({ prompt_id: id('Prompt ID (from ai_setup_status).') }, ['prompt_id']),
    annotations: READ,
    isAvailable: isAdmin,
    handler: async (args, ctx) => shapePrompt((await ctx.api.request('GET', `/api/prompts/${args.prompt_id}`)).prompt, true)
  },
  {
    name: 'save_prompt',
    title: 'Create or update a prompt',
    description:
      'System Admin: create a prompt, or update the one with the same name. For text, optionally pin a provider/model (default: the app default, gpt-4o-mini). Set makes_image=true for poster prompts (always gpt-image-1.5).',
    inputSchema: obj(
      {
        name: name('Prompt name (unique). Updating keeps the same name.'),
        text: text('The prompt. Use {placeholders} for app data, e.g. {companyInfo}, {campaignDetails}, {taskDescription}.', 50000),
        provider: { type: ['string', 'null'], enum: [...PROVIDERS, null], description: 'Text provider for this prompt; null = app default.' },
        model: { type: ['string', 'null'], maxLength: 100, description: 'Text model, e.g. gpt-4o-mini; null = app default.' },
        makes_image: { type: 'boolean', description: 'This prompt generates an image (poster).' }
      },
      ['name', 'text']
    ),
    annotations: UPDATE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      const all = (await ctx.api.request('GET', '/api/prompts')).prompts || [];
      const existing = all.find((p: any) => p.name === args.name);
      const settings: Record<string, unknown> = {};
      if (args.provider !== undefined) settings.llmProvider = args.provider || null;
      if (args.model !== undefined) settings.llmModel = args.model || null;
      if (args.makes_image !== undefined) {
        settings.imageLLMProvider = args.makes_image ? 'openai' : null;
        settings.imageLLMModel = args.makes_image ? 'gpt-image-1.5' : null;
      }
      let prompt;
      if (existing) {
        prompt = (await ctx.api.request('PATCH', `/api/prompts/${existing._id}`, { body: { details: args.text, ...settings } })).prompt;
      } else {
        prompt = (await ctx.api.request('POST', '/api/prompts', { body: { name: args.name, details: args.text, ...settings } })).prompt;
      }
      return { message: existing ? 'Prompt updated' : 'Prompt created', prompt: shapePrompt(prompt) };
    }
  },
  {
    name: 'delete_prompt',
    title: 'Delete prompt',
    description: 'System Admin: delete a prompt. Commands that use it stop working until pointed at another prompt. Confirm with the user first.',
    inputSchema: obj({ prompt_id: id('Prompt ID.') }, ['prompt_id']),
    annotations: DESTRUCTIVE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => ({ message: (await ctx.api.request('DELETE', `/api/prompts/${args.prompt_id}`)).message || 'Deleted' })
  },
  {
    name: 'set_command',
    title: 'Point a command at a prompt',
    description:
      "System Admin: make a command (e.g. generate-campaign, refine-task-description, generate-poster, or your own) run a prompt, by prompt name. Creates the command or re-points it.",
    inputSchema: obj(
      {
        command: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9][a-z0-9-]*$', description: 'Command name, lower-case with dashes.' },
        prompt_name: name('Name of the prompt to run.')
      },
      ['command', 'prompt_name']
    ),
    annotations: UPDATE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      const [prompts, mappings] = await Promise.all([ctx.api.request('GET', '/api/prompts'), ctx.api.request('GET', '/api/command-mappings')]);
      const prompt = (prompts.prompts || []).find((p: any) => p.name === args.prompt_name);
      if (!prompt) throw new ToolError(`No prompt named "${args.prompt_name}". Create it first with save_prompt.`);
      const existing = (mappings.mappings || []).find((m: any) => m.command === args.command);
      const res = existing
        ? await ctx.api.request('PATCH', `/api/command-mappings/${existing._id}`, { body: { promptId: String(prompt._id) } })
        : await ctx.api.request('POST', '/api/command-mappings', { body: { command: args.command, promptId: String(prompt._id) } });
      return { message: existing ? 'Command re-pointed' : 'Command created', command: shapeMapping(res.mapping || { _id: existing?._id, command: args.command, promptId: prompt }) };
    }
  },
  {
    name: 'delete_command',
    title: 'Delete command',
    description: "System Admin: remove a command mapping. The app's button for it stops working. Confirm with the user first.",
    inputSchema: obj({ command_id: id('Command mapping ID (from ai_setup_status).') }, ['command_id']),
    annotations: DESTRUCTIVE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => ({ message: (await ctx.api.request('DELETE', `/api/command-mappings/${args.command_id}`)).message || 'Deleted' })
  },
  {
    name: 'run_prompt',
    title: 'Test a prompt',
    description:
      'System Admin: run a saved prompt once with sample values for its placeholders and see the AI reply, model usage and cost. Use it to test the AI connection and prompt quality. Text prompts only.',
    inputSchema: obj(
      {
        prompt_name: name('Prompt to run.'),
        values: { type: 'object', additionalProperties: true, description: 'Values for placeholders, e.g. {"taskDescription": "…", "companyInfo": {"companyName": "…"}}.' }
      },
      ['prompt_name']
    ),
    annotations: CREATE,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', '/api/llm/run', { body: { promptName: args.prompt_name, dynamicData: args.values || {} }, timeoutMs: 120000 });
      return { reply: res.content, usage: res.usage, compiled_prompt: String(res.compiledPrompt || '').slice(0, 4000) };
    }
  },
  {
    name: 'ai_usage',
    title: 'AI usage and cost',
    description: 'System Admin: recent AI calls (feature, model, tokens, estimated cost, success) and the totals.',
    inputSchema: obj({ limit: limit(15, 100), failures_only: { type: 'boolean', description: 'Only failed calls.' } }),
    annotations: READ,
    isAvailable: isAdmin,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('GET', '/api/llm/usage', { query: { limit: args.limit ?? 15, success: args.failures_only ? 'false' : undefined } });
      return {
        totals: { calls: (res.totals.successCount || 0) + (res.totals.failureCount || 0), failed: res.totals.failureCount || 0, tokens: res.totals.totalTokens, estimated_cost_usd: Number((res.totals.totalCost || 0).toFixed(4)) },
        recent: (res.usageLogs || []).map((u: any) =>
          clean({
            at: u.createdAt,
            feature: u.promptName,
            model: u.llmModel,
            tokens: u.totalTokens,
            cost_usd: u.estimatedCost !== undefined ? Number(Number(u.estimatedCost).toFixed(5)) : undefined,
            ok: u.success,
            error: u.errorMessage || undefined,
            user: u.userId ? `${u.userId.firstName || ''} ${u.userId.lastName || ''}`.trim() : undefined,
            seconds: u.requestDuration ? Math.round(u.requestDuration / 100) / 10 : undefined
          })
        )
      };
    }
  },
  {
    name: 'generate_task_poster',
    title: 'Create an AI image for a post (app AI)',
    description:
      "Make an image for a post (task) with the app's AI. It's saved as a pending image: adopt it with adopt_task_poster (it becomes the post's image and a new Library version) or discard it. Uses one of the account's monthly AI images; confirm with the user first.",
    inputSchema: obj({ task_id: id('Task ID.') }, ['task_id']),
    annotations: CREATE,
    isAvailable: canUseAI,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('POST', `/api/tasks/${args.task_id}/generate-poster`, { timeoutMs: 240000 });
      return { message: res.message, pending_image_url: res.generatedImageUrl, task_url: absolute(ctx.appUrl, links.post(args.task_id)) };
    }
  },
  {
    name: 'adopt_task_poster',
    title: 'Use or discard a pending AI image',
    description: 'Keep the pending AI image as the post\'s image (adopt) or throw it away (discard).',
    inputSchema: obj({ task_id: id('Task ID.'), action: { type: 'string', enum: ['adopt', 'discard'], description: 'adopt or discard' } }, ['task_id', 'action']),
    annotations: UPDATE,
    isAvailable: canUseAI,
    handler: async (args, ctx) => {
      const res = await ctx.api.request('PATCH', `/api/tasks/${args.task_id}/${args.action === 'adopt' ? 'adopt-poster' : 'discard-poster'}`);
      return { message: res.message, image_url: res.task?.designedImage || undefined };
    }
  }
];

export const TOOLS: Tool[] = [
  ...accountTools,
  ...campaignTools,
  ...projectTools,
  ...taskTools,
  ...commentTools,
  ...libraryTools,
  ...publishingTools,
  ...inboxTools,
  ...aiTools,
  ...aiAdminTools,
  ...adminTools
];

export const SERVER_INSTRUCTIONS = `This connector works with the user's Blueprint app (planning and publishing social media posts), acting as the user with exactly their permissions.

Structure: Campaign → Themes → Posts. In the tools a theme is a "project" and a post is a "task" (older names for the same things); talk to the user about themes and posts. A post has a title (name), a brief (description), a day (task_date, which places it in the Planner), a status and a caption (content, the text that gets published and shown in the app's social previews). Statuses: Idea, Draft and Ready are set by the user; Scheduled, Published and Needs attention follow Publishing automatically and can't be set by hand. Comments can be attached to campaigns, themes and posts.

How to work:
- Use list_campaigns / get_campaign / get_project / list_tasks to find ids before changing anything. Never invent ids.
- Use get_my_account or get_company_info to write in the user's brand voice.
- To plan content, create the campaign and its themes (create_project), then add posts with create_tasks (each with a day, a brief and a finished caption).
- Updates only change the fields you pass.
- archive_campaign, delete_task, delete_comment, remove_user_from_project and deactivate_user remove things: confirm with the user first.
- Every result includes a "url" the user can open in the app.
- Pictures can't be uploaded through this connector; tell the user to add them on the post in the app (Upload, From the Library, or Create image with AI).
- Themes can be deleted only in the app, and only when they have no posts.
- The Inbox (list_inbox) holds reminders that need the user (posts due by hand, failed posts, accounts to reconnect) and messages from the Blueprint team; inbox_action runs an item's action after the user agrees.
- Publishing: list_publishing_channels shows connected accounts; schedule_post publishes a post now or later (always confirm accounts, caption and time with the user first); accounts that aren't connected can get "post by hand" reminders.
- The Library holds the user's past and present work (pictures, captions, logos, files) with full version history. To find something, call library_overview first to see which years, months and events exist, then search_library with a date range and/or words. Never guess item ids.`;
