# Blueprint optimization (branch `planner`)

The features are in place; this phase makes the app simpler, consistent and comfortable for a
**single user** who plans, makes and publishes their own social posts (plus the System Admin).
No teams or approvals. Backend data, API routes and the Claude connector stay compatible.

## Decisions (agreed 17 Nov 2026)

| # | Decision |
|---|---|
| 1 | Calendar + Tasks Sheet + Details Sheet become one page: **Planner** (Calendar: month/week · List, with grouping) |
| 2 | Projects fold into the campaign page as **Themes** (no separate project page; old links redirect) |
| 3 | Dashboard becomes **Today** |
| 4 | Publishing stays a page: accounts, publishing queue, history. Upcoming posts also show in the Planner |
| 5 | Settings split into sections with their own addresses |
| 6 | Clean addresses; old ones redirect |
| 7 | Task → **Post** (in everything people see; code/API/database names stay `task`) |
| 8 | Project → **Theme** |
| 9 | Post statuses: **Idea → Draft → Ready → Scheduled → Published**, plus **Needs attention** |
| 10 | One name: **Blueprint** (assistant: **Blue**) |
| 11 | Publishing records shown as "Scheduled to Instagram · Fri 9:00"; list = **Publishing queue** |
| 12 | Plain words everywhere (table below) |
| 13 | One caption for all platforms (per-platform versions later) |
| 14 | Calendar cards coloured by campaign; status as a dot |
| 15 | "Improve caption" is the main AI writing action; "Improve brief" stays as a secondary option |
| 16 | Edit the caption inside the post preview, with platform limits and the "see more" line |
| 17 | Plan with AI: review a draft plan before anything is created |
| 18 | Restoring a Library version offers "Also use this on the post" |
| 19 | Team features hidden (project assignments/roles, role labels) |
| 20 | Monthly AI allowance per user (defaults: 20 AI images, 300 Blue messages), editable per user |
| 21 | Default image quality: medium |
| 22 | Prompt placeholders: new names, old names keep working, unknown names warned, preview with a real post |
| 23 | All feedback items, in stages |
| 24 | Hosting/speed: later |
| 25 | Branch `planner` from `inbox` |
| 26 | Keep test data until the end |
| 27 | Everything in one session; maximum care; the user tests at the end |

## Vocabulary (what people see)

| Was | Now |
|---|---|
| Task / tasks | Post / posts |
| Project | Theme |
| Description (task) | Brief |
| Content / post content | Caption |
| Designed image | Image |
| Attached images | Reference images |
| Pending generated image | AI draft image ("Use" / "Discard") |
| Generate campaign / Generate tasks | Plan with AI |
| Refine description | Improve brief (secondary) · **Improve caption** (main) |
| Generate poster | Create image with AI |
| Company info | Brand |
| Calendar / Tasks Sheet / Details Sheet | Planner |
| Dashboard | Today |
| Publishing posts (records) | Publishing queue / "Scheduled to …" |
| Part one / Part two | AI on / AI off |
| Hybrid / System Admin | hidden; "Admin" only on admin screens |
| Campaign Mgmt / Campaign Management Platform | Blueprint |

Buttons: verb first, sentence case, short. "Archive" where the action archives.

## Post status model

Stored values (Task.status): `Idea`, `Draft`, `Ready`, `Scheduled`, `Published`, `Needs attention`.

- People choose Idea, Draft, Ready (and "Mark as published" for posts made by hand).
- Publishing sets Scheduled (on schedule), Published (on publish / marked posted), Needs attention
  (failed, or due by hand), and back to Ready when every post of it is cancelled.
- Migration at startup (idempotent): Pending → Draft, In Progress → Draft, Completed → Ready
  (Published when the task has a published post).
- API/connector accept the old values as aliases (Pending/In Progress → Draft, Completed → Ready).

Colours (one map, everywhere): Idea grey · Draft amber · Ready blue · Scheduled violet ·
Published green · Needs attention red. Red only ever means a problem.

## Addresses

| Address | Page |
|---|---|
| `/` | Today |
| `/planner?view=month\|week\|list&date=YYYY-MM-DD&group=…&…filters` | Planner |
| any page `?post=<id>` | opens the post in the side panel (Back closes) |
| `/posts/<id>` | a post, full page |
| `/campaigns`, `/campaigns/<id>?theme=<id>` | campaigns; one campaign with its themes |
| `/library`, `/library/<id>` | Library |
| `/inbox` | Inbox |
| `/publishing?tab=queue\|accounts\|history&item=<id>` | Publishing (`item` points out one scheduled copy) |
| `/blue`, `/blue/<chatId>` | Blue full screen |
| `/settings/<section>` | profile · brand · integrations, and for admins ai · prompts |
| `/admin/users`, `/admin/users/<id>`, `/admin/outreach` | admin |

Redirects: `/calendar` → `/planner?view=month`, `/tasks-sheet` → `/planner?view=list`,
`/details-sheet` → `/planner?view=list&group=campaign`, `/tasks/<id>` → `/posts/<id>`,
`/projects/<id>` → its campaign `?theme=<id>`, `/dashboard` → `/`, `/settings?tab=…` → `/settings/<section>`,
Publishing's old tabs (`upcoming`, `attention`, `draft` → queue; `done` → history; `channels` → accounts).

All links come from one map: `frontend/src/lib/paths.ts` and `backend/src/lib/links.ts`.

## Shared building blocks (one of each)

- `lib/status.ts` (labels, colours, order), `lib/dates.ts` (one date style, user time zone),
  `lib/paths.ts` (links)
- `PageHeader` (title, subtitle, main action on the right, breadcrumbs)
- `FilterBar` (search, quick chips, Filter menu with counts, removable chips, saved in the address)
- `StatusChip`, `PostCard` (poster thumb, title, time, platforms, status dot, campaign colour)
- `PostPanel` (side panel; bottom sheet on phones) opened by `?post=` from anywhere
- `PostEditor` (caption/brief/image/date/status; preview with in-place caption editing, platform
  limits, "see more" line, Improve caption)
- `Toasts` with Undo (`notify`), `useConfirm` (in-app “Are you sure?”), `EmptyState`, first steps on
  Today, `CommandPalette` (Ctrl/⌘ K)

## Stages

1. **Foundations**: status model + migration (backend, connector, Blue, AI generation),
   vocabulary, links maps (both sides), shared building blocks, toasts.
2. **Post panel and editor**: `?post=` from anywhere, preview editing, Improve caption (command +
   prompt + placeholders), AI image progress, Library "also use on the post".
3. **Planner**: month/week cards, hover preview, list with grouping, unscheduled tray, drag to
   reschedule, "+" on a day, FilterBar; remove Calendar/TasksSheet/DetailsSheet; redirects.
4. **Pages**: Today, Campaigns + campaign page with themes, post full page, Publishing (queue /
   accounts / history), Inbox and Library wording/links, Settings sections, Admin screens.
5. **AI**: Plan with AI (draft → review → create), allowances per user, image quality default,
   placeholder aliases/validation/preview in the prompt editor, Blue + connector wording/links.
6. **Polish**: Blueprint name, setup checklist, empty states, Ctrl+K search, errors, phone layout
   (no floating button over content), accessibility (sizes, contrast, focus), confirmations + undo.
7. **Check**: reread every changed file, self-tests, docs, then the user's build + click-through.

## Progress

All seven stages are done on `planner` (17 Nov 2026). Self-tests: posts 14, connector 29, Blue 16,
Library 11, Publishing 13, Inbox 5, all passing.

What's new for people, by page:

- **Today** (`/`): first steps until done or hidden; counts that open the matching filtered view;
  what needs attention; the next 7 days; campaigns running.
- **Planner**: month, week and list; filters in the address; drag a post to another day (Undo);
  "No day yet" tray; ← → and T keys; list starts at today with earlier posts folded.
- **Post** (side panel from anywhere, or `/posts/<id>`): title, status, day, image (upload, Library,
  AI with progress, Canva), caption with Improve caption and the editable preview, brief with Improve
  brief, reference images, Publishing, notes, Move to another theme or campaign, Delete.
- **Campaigns** and **campaign page**: cards with progress; themes on the left; Plan with AI
  (draft → review → create); edit campaign and themes; delete empty themes; archive asks first when
  it would cancel scheduled posts.
- **Publishing**: Queue (needs you, going out, drafts), Accounts, History.
- **Settings**: Profile (name, password, appearance, AI used this month), Brand, Integrations;
  admins also AI (keys, models, monthly allowance, Blue, Library) and Prompts (with the placeholder
  picker, unknown-name warnings and a preview with a real post).
- **Admin › Users**: AI on/off, per-account allowance, features, deactivate.
- **Everywhere**: Ctrl/⌘ K search; Ctrl/⌘ J Blue; Ctrl/⌘ S saves a post; no browser pop-ups.

New or changed API:

- `POST /api/campaigns/:id/plan` (draft), `POST /api/campaigns/:id/plan/apply` (create);
  `/generate` runs both (connector). `GET /api/campaigns?include=counts`.
- `PUT /api/tasks/:id` accepts `projectId` (move; scheduled copies and Library links follow).
- `DELETE /api/projects/:id` (empty themes only).
- `PATCH /api/users/me`, `POST /api/users/me/password`, `GET /api/users/me/ai-usage`,
  `GET|PATCH /api/users/settings/ai-allowance`, `GET /api/users/:id/ai-usage`,
  `PUT /api/users/:id` accepts `aiAllowance`, `GET /api/users?includeInactive=true`.
- `GET /api/prompts/placeholders`, `POST /api/prompts/check`, `POST /api/prompts/preview`.
- `GET /api/auth/me` adds `hasPassword`, `authProvider`; Blue status adds `remainingThisMonth`.
- Connector: `improve_caption` tool; `generate_campaign_content` takes notes, dates and posts a
  week; `update_task` takes `project_id`.

Settings that changed: `IMAGE_QUALITY` defaults to `medium`; monthly allowance defaults are 20 AI
images and 300 Blue messages per client account (Settings › AI; 0 = no limit).

## How to check (for the build and click-through)

1. `cd backend && npm install && npm run build && npm run selftest`
2. `cd frontend && npm install && npm run build` (the calendar and date libraries were removed, so
   `npm install` updates `node_modules`).
3. Start both, sign in as the test client, and walk through: Today → Planner (drag a post, Undo,
   No day yet tray, filters, list) → open a post (edit the caption in the preview, Improve caption,
   Move, change day and status) → Campaigns → a campaign (themes, Plan with AI review, edit theme,
   delete an empty theme) → Publishing (queue, accounts, history) → Settings (each section) →
   Ctrl+K search → Blue (open a post from a chat card; "Which posts are still in Draft?").
4. As admin: Users (AI on/off, allowance), Settings › AI and Prompts (insert a placeholder, type a
   wrong one, preview with a post).
5. Old links still work: `/calendar`, `/tasks-sheet`, `/details-sheet`, `/tasks/<id>`,
   `/projects/<id>`, `/settings?tab=…`, `/publishing?tab=channels`.
