# Claude connector (MCP)

Lets a user work with the app from a Claude chat: read and create campaigns, projects, tasks and comments, plan a content calendar, update statuses and post copy. Claude signs in **as the user** through OAuth and gets **exactly that user's permissions**, no more.

- **Who can use it:** everyone by default. A System Admin can switch it off per account (Admin → Users → user → *Claude Connector*). Switching it off disconnects that user's Claude immediately.
- **Part one / Part two:** both parts can connect. Part two users get no AI-generation tools, and the API refuses those calls anyway. Part one users and admins also get the app's own AI commands as tools.
- **Scope of this version:** text only. Image upload through Claude comes in a later phase.

---

## How it works

```
Claude ──HTTPS──▶  /mcp  (MCP, Streamable HTTP, stateless JSON)
                    │  Authorization: Bearer <access token>
                    ▼
            tool handler ──loopback──▶ /api/...  (same routes as the web app, as the same user)

Claude ──▶ /.well-known/oauth-protected-resource      (RFC 9728)
       ──▶ /.well-known/oauth-authorization-server    (RFC 8414)
       ──▶ /oauth/register                            (Dynamic Client Registration, RFC 7591)
       ──▶ /oauth/authorize ──302──▶ <FRONTEND_URL>/oauth/consent  (user signs in normally, clicks Allow)
       ──▶ /oauth/token     (authorization_code + PKCE S256, refresh_token with rotation)
       ──▶ /oauth/revoke    (RFC 7009)
```

Each tool calls the existing REST API with the user's token. So the connector cannot drift from the app: every role check, ownership rule, Part one/Part two guard, validation rule and audit-log entry applies. Audit entries made through Claude are tagged `metadata.via = "claude_connector"`.

Code map (backend):

| Path | What it does |
|---|---|
| `src/oauth/oauth.routes.ts` | Discovery, registration, authorize, token, revoke endpoints |
| `src/oauth/oauthService.ts` | Clients, authorization codes, tokens (hashed), validation, revocation |
| `src/oauth/crypto.ts` | PKCE, redirect-URI rules, token helpers |
| `src/routes/connectedApps.routes.ts` | Consent API + Settings → *Connected apps* (session only) |
| `src/middleware/bearerAuth.ts` | Lets OAuth tokens authenticate `/api` requests as the user |
| `src/mcp/router.ts` | The `/mcp` endpoint (auth, rate limit, JSON-RPC over HTTP) |
| `src/mcp/protocol.ts` | MCP JSON-RPC handling (initialize, ping, tools/list, tools/call) |
| `src/mcp/tools.ts` | The tool catalog (below) |
| `src/models/OAuth*.ts` | `oauthclients`, `oauthauthorizations` (auto-expire), `oauthtokens` (auto-expire) |

Frontend: `pages/OAuth/OAuthConsent.tsx` (consent screen), `components/Settings/ClaudeConnectorCard.tsx` (Settings → Integrations), admin toggle in `pages/Admin/UserDetail.tsx` and `UserManagement.tsx`.

---

## Local testing setup (database on localhost)

Claude connects from Anthropic's cloud, so your backend needs a public HTTPS address. Use a tunnel to `localhost:5000`. The frontend stays on `http://localhost:3000`, which works because the consent page opens in *your* browser.

1. **Install and build**
   ```bash
   cd backend && npm install && npm run build
   cd ../frontend && npm install && npm run build
   ```
   `npm run build` type-checks everything. Fix or report any error before going further.

2. **Run the self-test** (no database needed)
   ```bash
   cd backend && npm run mcp:selftest
   ```
   Expect `all 29 checks passed`.

3. **Start a tunnel** to the backend port. Either:
   - **Cloudflare (recommended, no interstitial page):** `cloudflared tunnel --url http://localhost:5000`. Copy the `https://….trycloudflare.com` URL.
   - **ngrok:** `ngrok http 5000`. The free plan shows a "You are about to visit…" page in the browser during sign-in; click *Visit Site*.

   Quick tunnels get a new URL each time they start. Update step 4 and re-add the connector in Claude if it changes.

4. **Configure** `backend/.env`:
   ```env
   MCP_PUBLIC_URL=https://your-tunnel-url        # no trailing slash
   FRONTEND_URL=http://localhost:3000
   ```
   Restart the backend (`npm run dev`) and the frontend (`npm run dev`).

5. **Run the end-to-end smoke test** against the running server. It goes through the tunnel, like Claude does:
   ```bash
   cd backend
   npm run mcp:smoke -- --email you@example.com --password yourpassword
   ```
   Use an email/password account. It goes through discovery → registration → authorize → consent → token → MCP → refresh → revoke. Along the way it creates a test campaign, project and tasks, then archives the campaign. Expect `All N checks passed`. The first failing step prints exactly what went wrong.

6. **Check the app:** Settings → Integrations shows a *Claude connector* card with the connector URL (`<MCP_PUBLIC_URL>/mcp`).

## Connecting Claude

**claude.ai / Claude Desktop:** Settings → Connectors → *Add custom connector* (in some versions: *Add → Custom → Web*). Name it e.g. **Blueprint**, paste the connector URL, continue, then click *Connect*. Your browser opens the app's consent page. Sign in if needed, then click **Allow**. You're sent back to Claude and the tools appear. Enable the connector in a chat from the tools menu. Free Claude plans allow one custom connector.

**Claude Code:**
```bash
claude mcp add --transport http blueprint https://your-tunnel-url/mcp
```
Then run `/mcp` in Claude Code and choose *Authenticate*.

**Disconnecting:** Settings → Integrations → *Disconnect*, or remove the connector in Claude. An admin switching the connector off for a user also disconnects them.

## Things to try in Claude

- "What campaigns do I have? Show me what's on the calendar for the next two weeks."
- "Create a campaign 'Holiday Sale 2026' from Dec 1–24 with a 'Social posts' project and 6 dated Instagram posts, with finished captions and hashtags in our brand voice."
- "Mark the teaser post as completed and leave a comment that it's approved."
- "Move all December posts in the Social posts project one day later."
- (Part two account) "Generate this campaign with the app's AI." Claude should say the tool isn't available.
- (Admin) "Turn off the Claude connector for bo@example.com." That user's Claude stops working on its next request.

---

## Tools

| Tool | What it does | Who |
|---|---|---|
| `get_my_account` | Profile, role, part, AI availability, company info | all |
| `get_company_info` / `update_company_info` | Brand and company profile | all |
| `list_campaigns` / `get_campaign` | Campaigns (filters, archived), one campaign with projects and task counts | all |
| `create_campaign` / `update_campaign` | Create / edit a campaign | all |
| `archive_campaign` / `restore_campaign` | "Delete" (archive) and bring back | all |
| `list_projects` / `get_project` | Projects; one project with tasks and comments | all |
| `create_project` / `update_project` | Create / edit a project | all |
| `assign_user_to_project` / `remove_user_from_project` | Team assignments | all |
| `list_tasks` / `get_task` / `get_calendar` | Tasks, one task with comments, tasks by day | all |
| `create_task` / `create_tasks` / `update_task` / `delete_task` | Task CRUD (bulk create up to 50) | all |
| `list_comments` / `add_comment` / `update_comment` / `delete_comment` | Comments on campaigns, projects and tasks | all |
| `generate_campaign_content` / `refine_task_description` | The app's own AI commands | Part one + admins |
| `list_users` / `get_user` / `create_user` / `update_user` / `deactivate_user` | Account admin, including part and connector toggle | System Admins |

"All" still means *within the user's own data*: Hybrid users only see and change campaigns they created and everything under them, same as in the app. Destructive tools are marked as such, so Claude asks before running them.

Not included, because the app doesn't allow it either or it's out of scope for now: deleting projects, uploading images, connecting Canva, AI provider keys and prompt settings.

---

## Security model

- OAuth 2.1 authorization code flow with mandatory PKCE (S256), Dynamic Client Registration, exact redirect-URI matching (loopback URIs may vary the port), RFC 9207 `iss` in redirects, and RFC 8707 resource checks.
- Tokens are random 256-bit values. Only SHA-256 hashes are stored. Access tokens last 1 hour and refresh tokens 30 days, with rotation on every refresh. Codes are single-use and expire after 5 minutes.
- Every request re-checks the user: an inactive account, or one with the connector turned off, is refused at once.
- Tokens cannot sign in or out, approve new connections or manage connected apps. Those only work in the web app.
- `/mcp` is rate-limited per token (600 requests per 5 minutes) and the OAuth endpoints per IP. The connector's internal API calls skip the per-IP `/api` limit.

## Production notes

- Set `MCP_PUBLIC_URL` to the public backend URL and `FRONTEND_URL` to the public app URL.
- If one domain serves both app and API through a reverse proxy, route **`/mcp`, `/oauth/*` (except `/oauth/consent`, which is a frontend page) and `/.well-known/*`** to the backend, as well as `/api`.
- Behind a hosted load balancer, set `TRUST_PROXY` (e.g. `1`).
- Optional: `MCP_ALLOWED_ORIGINS` to restrict browser origins on `/mcp`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude says it can't reach the server | The tunnel is down or its URL changed. Restart it, update `MCP_PUBLIC_URL`, restart the backend, re-add the connector. |
| Smoke test: "resource is …/mcp" fails | `MCP_PUBLIC_URL` doesn't match the URL you're testing. |
| Consent page says the request expired | More than 10 minutes passed. Click *Connect* in Claude again. |
| "Claude connector access is turned off" | An admin disabled it. Enable it in Admin → Users → user. |
| Tools return `Error (HTTP 403) … [AI_GENERATION_DISABLED]` | Part two account: expected. |
| Everything returns 401 after an admin change | Tokens were revoked on purpose. Reconnect in Claude. |
