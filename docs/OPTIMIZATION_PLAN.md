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
| `/campaigns`, `/campaigns/<id>` (`#theme-<id>`) | campaigns; one campaign with its themes |
| `/library`, `/library/<id>` | Library |
| `/inbox` | Inbox |
| `/publishing?tab=queue\|accounts\|history` | Publishing |
| `/blue`, `/blue/<chatId>` | Blue full screen |
| `/settings/<section>` | profile · brand · ai · accounts · integrations · library · admin sections |
| `/admin/users`, `/admin/users/<id>`, `/admin/outreach` | admin |

Redirects: `/calendar` → `/planner?view=month`, `/tasks-sheet` → `/planner?view=list`,
`/details-sheet` → `/planner?view=list&group=campaign`, `/tasks/<id>` → `/posts/<id>`,
`/projects/<id>` → its campaign `#theme-<id>`, `/settings?tab=…` → `/settings/<section>`.

All links come from one map: `frontend/src/lib/paths.ts` and `backend/src/lib/links.ts`.

## Shared building blocks (one of each)

- `lib/status.ts` (labels, colours, order), `lib/dates.ts` (one date style, user time zone),
  `lib/terms.ts` (vocabulary), `lib/paths.ts` (links)
- `PageHeader` (title, subtitle, main action on the right, breadcrumbs)
- `FilterBar` (search, quick chips, Filter menu with counts, removable chips, saved in the address)
- `StatusChip`, `PostCard` (poster thumb, title, time, platforms, status dot, campaign colour)
- `PostPanel` (side panel; bottom sheet on phones) opened by `?post=` from anywhere
- `PostEditor` (caption/brief/image/date/status; preview with in-place caption editing, platform
  limits, "see more" line, Improve caption)
- `Toasts` with Undo; `EmptyState`; `SetupChecklist`; `CommandSearch` (Ctrl+K)

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

(updated as stages complete)
