# Blue — the in-app assistant

Blue lets users run the app by chatting instead of learning every screen: "create a task for the shoe sale on Friday", "what's on my calendar next week?", "mark the teaser as done and leave a comment". Blue does the work in the app and shows the results as cards with links.

- **Who can use it:** every user, whatever their Part. System Admins can switch it off for everyone (Settings → LLM Settings → Blue assistant) or for one person (Admin → Users → user → *Blue Assistant*).
- **What it can do:** everything the Claude connector can do (it uses the same 33 actions), with the user's own permissions. Part two users don't get the app's AI generation actions; Blue writes their content itself.
- **Safety:** deleting, archiving, removing someone from a project or deactivating an account always shows **Confirm / Cancel** first. Actions are written to the audit log with `metadata.via = "blue_assistant"`.
- **Cost:** Blue runs on your organisation's AI keys. Each successful message counts toward a per-user daily limit (default 100, configurable; 0 = unlimited). Token usage is recorded in LLM usage as "Blue assistant".

## Using it

- Desktop: the **Blue** button at the top of the sidebar (above Dashboard), or **Ctrl+J** / **⌘J**, toggles a panel docked on the right. The expand button makes it wider. The panel stays open while you move between pages.
- Phones: the round **B** button at the bottom right opens Blue full screen.
- Blue knows which page you're on: on a task page, "approve this" or "rewrite this caption" refers to that task.
- Chats are saved: the history button reopens previous chats; the new-chat button starts fresh.
- After Blue changes something, the page behind the panel reloads to show it.

## Setting it up (System Admin)

1. Add an API key for **Anthropic**, **OpenAI** or **Grok** in Settings → Integrations (Gemini isn't supported for Blue yet).
2. Settings → LLM Settings → **Blue assistant**: choose the provider and model, and the daily message limit. Defaults if left empty: Anthropic `claude-haiku-5-5`, OpenAI `gpt-4o-mini`; Grok needs a model ID. The model must support tool use.
3. Save. The card shows which provider and model Blue is actually using, or what's missing.

## How it works

```
Blue panel ──POST /api/blue/conversations/:id/messages (streamed events)──▶ Blue agent
   agent ⇄ AI provider (tool calling: Anthropic Messages API / OpenAI-compatible Chat Completions)
   agent ──tool call──▶ same tool catalog as the MCP connector (src/mcp/tools.ts)
         ──loopback HTTP, acting as the signed-in user──▶ /api/... (normal routes and permission checks)
```

| Path | What it does |
|---|---|
| `backend/src/blue/agent.ts` | Agent loop: runs tools, pauses destructive ones for confirmation, bounded steps and history |
| `backend/src/blue/providers.ts` | Anthropic and OpenAI/Grok adapters over HTTPS (prompt caching on Anthropic) |
| `backend/src/blue/prompt.ts` | System prompt: user, today's date in their time zone, current page |
| `backend/src/blue/setup.ts` | Which provider/model Blue uses, from the admin settings and configured keys |
| `backend/src/routes/blue.routes.ts` | Chats, streaming messages, confirm/cancel, status, admin settings |
| `backend/src/models/BlueConversation.ts` | Saved chats |
| `frontend/src/components/Blue/*` | Panel, result cards (tasks, campaigns, projects, calendar, comments, users, post preview) |
| `frontend/src/store/blueStore.ts` | Panel state and streaming |

Blue's own calls to the API use a per-process secret and are accepted only from the server itself (loopback). Bearer tokens (Claude connector) cannot reach `/api/blue`.

## Testing

```bash
cd backend
npm run blue:selftest   # 16 checks: provider formats, agent loop, confirmations, prompt, history (no DB, no network)
npm run mcp:selftest    # 29 checks for the shared tool catalog
```

Then in the app:
1. As an admin, open Settings → LLM Settings → Blue assistant and confirm it shows the provider and model in use.
2. Press Ctrl+J and try "What's on my calendar on 27 November?" The calendar card should list the tasks.
3. "Create a task for shoe sales on Friday in the Social Media Posts project with a caption." A task card appears, and the page behind the panel updates.
4. "Delete that task." A Confirm card appears; Cancel, then try again and Confirm.
5. As a Part two user, ask Blue to "generate the campaign with the app's AI". It should explain that isn't in their plan.
6. Turn Blue off for a user in Admin → Users: the Blue button disappears for them after reload, and the API refuses their messages.

## Limits in this version

- Replies appear step by step (each action and each reply as it finishes), not word by word.
- Images can't be attached or generated in the chat yet; existing task images are shown in cards.
- Gemini can't power Blue yet.
