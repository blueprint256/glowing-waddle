# Access modes: Part one and Part two

Both parts are the **same app** with the same data and screens (campaigns, projects, tasks, calendar, archives, settings, Canva import, manual image upload, social previews). The only difference is how content gets created.

| | Part one | Part two |
|---|---|---|
| AI generation (posters, campaign/task generation, description refinement) | Enabled | **Off** (no buttons in the UI, endpoints refuse) |
| Canva import, manual image upload, social previews | Yes | Yes |
| Future connectors (MCP for Claude / ChatGPT) | – | Planned |

A System Admin sets the mode per user (Admin → Users → create/edit, or the user's detail page). Switching modes never touches the user's data. System Admins always keep AI access. The setting is intended to be driven later by payment/subscription.

## How it works

- `User.accessMode`: `part_one` (default) or `part_two`. Legacy value `both` is treated as `part_one`.
- `canUseAI(user)` (backend `models/User.ts`, mirrored in frontend `types/index.ts`).
- Backend: `requireAI` middleware (`middleware/access.ts`) returns `403 { code: 'AI_GENERATION_DISABLED' }`. It is registered centrally in `server.ts` for the LLM, prompt, command-mapping, chain and AI-provider routes plus the campaign/task generate, refine and poster endpoints. **Any new AI endpoint must be added to that list.**
- Frontend: AI buttons and previews in `CampaignDetail` and `TaskDetail` are hidden when `canUseAI(user)` is false.

## Planned: connectors for Part two

An MCP server wrapping the existing API so Claude or ChatGPT can create/read projects and tasks and send images into a chosen task while the user chats. It will authenticate as the user and reuse existing ownership checks.
