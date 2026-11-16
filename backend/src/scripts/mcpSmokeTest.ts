/**
 * End-to-end smoke test for the Claude connector against a RUNNING backend.
 * Walks the same path Claude does: discovery → client registration → authorize → consent → token →
 * MCP initialize / tools → refresh → revoke. It creates a test campaign and archives it at the end.
 *
 *   npm run mcp:smoke -- --email you@example.com --password yourpassword [--base http://localhost:5000]
 *
 * --base defaults to MCP_PUBLIC_URL (your tunnel) or http://localhost:5000. Use an email/password account
 * (the consent step signs in through /api/auth/login). Exits with code 1 on the first failure.
 */
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BASE = (arg('base') || process.env.MCP_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
// Session login + consent always go to the backend directly (cookies are not shared with a tunnel domain).
const LOCAL = `http://localhost:${process.env.PORT || 5000}`;
const EMAIL = arg('email');
const PASSWORD = arg('password');
const REDIRECT_URI = 'http://127.0.0.1:8765/callback';

type Res = { status: number; headers: http.IncomingHttpHeaders; text: string; json: any };

function request(method: string, url: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<Res> {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method,
        headers: { ...(opts.body ? { 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}), ...(opts.headers || {}) }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
        });
      }
    );
    req.setTimeout(60000, () => req.destroy(new Error(`Timeout: ${method} ${url}`)));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const jsonBody = (o: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
const formBody = (o: Record<string, string>) => ({
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(o).toString()
});

let step = 0;
function ok(condition: unknown, message: string, detail?: unknown): asserts condition {
  step++;
  if (!condition) {
    console.error(`\n✗ ${step}. ${message}`);
    if (detail !== undefined) console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
    process.exit(1);
  }
  console.log(`✓ ${step}. ${message}`);
}

let rpcId = 0;
async function mcp(token: string, method: string, params?: unknown, notification = false) {
  const message: any = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
  if (!notification) message.id = ++rpcId;
  return request('POST', `${BASE}/mcp`, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'MCP-Protocol-Version': '2025-06-18'
    },
    body: JSON.stringify(message)
  });
}

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcp(token, 'tools/call', { name, arguments: args });
  if (res.status !== 200 || res.json?.error) {
    ok(false, `tools/call ${name} (HTTP ${res.status})`, res.json || res.text);
  }
  const text: string = res.json.result.content[0].text;
  if (res.json.result.isError) return { isError: true as const, text, data: undefined as any };
  return { isError: false as const, text, data: JSON.parse(text) };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Usage: npm run mcp:smoke -- --email you@example.com --password yourpassword [--base https://your-tunnel]');
    process.exit(1);
  }
  console.log(`Connector base URL: ${BASE}\nBackend (login/consent): ${LOCAL}\n`);

  // --- Discovery ------------------------------------------------------------
  const health = await request('GET', `${BASE}/health`);
  ok(health.status === 200, `backend reachable at ${BASE}`, health.text);

  const prm = await request('GET', `${BASE}/.well-known/oauth-protected-resource`);
  ok(prm.status === 200 && /\/mcp$/.test(prm.json?.resource), 'protected resource metadata', prm.json);
  ok(prm.json.resource === `${BASE}/mcp`, `resource is ${BASE}/mcp (set MCP_PUBLIC_URL if this fails)`, prm.json);
  const asUrl: string = prm.json.authorization_servers[0];

  const asm = await request('GET', `${asUrl}/.well-known/oauth-authorization-server`);
  ok(asm.status === 200 && asm.json?.code_challenge_methods_supported?.includes('S256'), 'authorization server metadata', asm.json);
  ok(asm.json.registration_endpoint && asm.json.token_endpoint && asm.json.authorization_endpoint, 'metadata lists all endpoints');

  const unauth = await request('POST', `${BASE}/mcp`, jsonBody({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  ok(unauth.status === 401 && /resource_metadata=/.test(String(unauth.headers['www-authenticate'])), 'MCP without a token → 401 with discovery hint', unauth.headers);

  // --- Client registration --------------------------------------------------
  const reg = await request('POST', asm.json.registration_endpoint, jsonBody({
    client_name: 'Connector smoke test',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  }));
  ok(reg.status === 201 && reg.json?.client_id, 'dynamic client registration', reg.json);
  const clientId: string = reg.json.client_id;

  const badReg = await request('POST', asm.json.registration_endpoint, jsonBody({ redirect_uris: ['http://evil.example.com/cb'] }));
  ok(badReg.status === 400 && badReg.json?.error === 'invalid_redirect_uri', 'non-https redirect URIs are refused', badReg.json);

  // --- Authorize → consent → code -------------------------------------------
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(8).toString('hex');
  const authUrl = new URL(asm.json.authorization_endpoint);
  Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'mcp',
    resource: prm.json.resource
  }).forEach(([k, v]) => authUrl.searchParams.set(k, v));
  const authz = await request('GET', authUrl.toString());
  const location = String(authz.headers.location || '');
  ok(authz.status === 302 && location.includes('/oauth/consent?request_id='), 'authorize redirects to the consent screen', { status: authz.status, location });
  const requestId = new URL(location).searchParams.get('request_id')!;

  const login = await request('POST', `${LOCAL}/api/auth/login`, jsonBody({ email: EMAIL, password: PASSWORD }));
  ok(login.status === 200, `signed in as ${EMAIL}`, login.json);
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

  const details = await request('GET', `${LOCAL}/api/oauth/requests/${requestId}`, { headers: { Cookie: cookie } });
  ok(details.status === 200 && details.json?.request?.clientName === 'Connector smoke test', 'consent screen details', details.json);
  if (!details.json.request.connectorAllowed) {
    ok(false, 'connector is enabled for this account (an admin turned it off: enable it in Admin → Users)');
  }

  const decision = await request('POST', `${LOCAL}/api/oauth/requests/${requestId}/decision`, {
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve: true })
  });
  ok(decision.status === 200 && decision.json?.redirectUrl, 'consent approved', decision.json);
  const redirect = new URL(decision.json.redirectUrl);
  ok(redirect.searchParams.get('state') === state && redirect.searchParams.get('code'), 'redirect carries code and state', decision.json.redirectUrl);
  ok(redirect.searchParams.get('iss') === asm.json.issuer, 'redirect carries the issuer (RFC 9207)', decision.json.redirectUrl);
  const code = redirect.searchParams.get('code')!;

  // --- Token exchange ---------------------------------------------------------
  const wrongVerifier = await request('POST', asm.json.token_endpoint, formBody({
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: 'x'.repeat(50)
  }));
  ok(wrongVerifier.status === 400 && wrongVerifier.json?.error === 'invalid_grant', 'wrong PKCE verifier is refused (and burns the code)', wrongVerifier.json);

  // The failed attempt consumed the code (one-time use), so run authorize + consent again.
  const authz2 = await request('GET', authUrl.toString());
  const requestId2 = new URL(String(authz2.headers.location)).searchParams.get('request_id')!;
  const decision2 = await request('POST', `${LOCAL}/api/oauth/requests/${requestId2}/decision`, {
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve: true })
  });
  const code2 = new URL(decision2.json.redirectUrl).searchParams.get('code')!;

  const tokenRes = await request('POST', asm.json.token_endpoint, formBody({
    grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource: prm.json.resource
  }));
  ok(tokenRes.status === 200 && tokenRes.json?.access_token && tokenRes.json?.refresh_token, 'authorization code → tokens', tokenRes.json);
  ok(tokenRes.json.token_type === 'Bearer' && tokenRes.json.expires_in > 0, 'token response shape');
  let access: string = tokenRes.json.access_token;
  let refresh: string = tokenRes.json.refresh_token;

  const replay = await request('POST', asm.json.token_endpoint, formBody({
    grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier
  }));
  ok(replay.status === 400 && replay.json?.error === 'invalid_grant', 'authorization codes are single-use', replay.json);

  // --- MCP protocol -----------------------------------------------------------
  const init = await mcp(access, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  ok(init.status === 200 && init.json?.result?.protocolVersion === '2025-06-18', 'MCP initialize', init.json);
  const initialized = await mcp(access, 'notifications/initialized', undefined, true);
  ok(initialized.status === 202, 'notifications/initialized → 202', initialized.status);
  const list = await mcp(access, 'tools/list', {});
  const toolNames: string[] = list.json?.result?.tools?.map((t: any) => t.name) || [];
  ok(toolNames.includes('create_task') && toolNames.includes('get_calendar'), `tools/list (${toolNames.length} tools)`, list.json);

  const me = await tool(access, 'get_my_account');
  ok(!me.isError && me.data.email === EMAIL.toLowerCase(), `get_my_account → ${me.data?.role}, ${me.data?.part}`, me.text);
  const aiTools = toolNames.filter((n) => n === 'generate_campaign_content' || n === 'refine_task_description');
  ok(me.data.ai_generation_available ? aiTools.length === 2 : aiTools.length === 0, `AI tools ${me.data.ai_generation_available ? 'offered (Part one/admin)' : 'hidden (Part two)'}`, toolNames);
  if (me.data.role === 'system_admin') ok(toolNames.includes('list_users'), 'admin tools offered to System Admin');
  else ok(!toolNames.includes('list_users'), 'admin tools hidden from non-admins');

  // --- Real data round trip -----------------------------------------------------
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const campaign = await tool(access, 'create_campaign', { name: `Connector smoke test ${stamp}`, description: 'Created by mcp:smoke. Safe to delete.', hashtags: ['#smoketest'], start_date: '2026-12-01', end_date: '2026-12-31' });
  ok(!campaign.isError && campaign.data.campaign.id, 'create_campaign', campaign.text);
  const campaignId = campaign.data.campaign.id;

  const project = await tool(access, 'create_project', { campaign_id: campaignId, name: 'Social posts', status: 'in_progress', due_date: '2026-12-20' });
  ok(!project.isError && project.data.project.status === 'in_progress', 'create_project (with status)', project.text);
  const projectId = project.data.project.id;

  const tasks = await tool(access, 'create_tasks', {
    project_id: projectId,
    tasks: [
      { name: 'Teaser post', task_date: '2026-12-02', content: 'Something big is coming… #smoketest' },
      { name: 'Launch post', task_date: '2026-12-05', content: 'It\'s here! #smoketest', status: 'In Progress' }
    ]
  });
  ok(!tasks.isError && tasks.data.results.every((r: any) => r.created), 'create_tasks (2)', tasks.text);
  const taskId = tasks.data.results[0].task.id;

  const badTask = await tool(access, 'create_task', { project_id: projectId, name: 'x', status: 'Done' });
  ok(badTask.isError && /status/.test(badTask.text), 'invalid status is refused with a clear message', badTask.text);

  const cal = await tool(access, 'get_calendar', { date_from: '2026-12-01', date_to: '2026-12-07', project_id: projectId });
  ok(!cal.isError && cal.data.total_tasks === 2 && cal.data.days['2026-12-02'], 'get_calendar', cal.text);

  const upd = await tool(access, 'update_task', { task_id: taskId, status: 'Completed', content: 'Updated copy #smoketest' });
  ok(!upd.isError && upd.data.task.status === 'Completed', 'update_task', upd.text);

  const comment = await tool(access, 'add_comment', { target_type: 'task', target_id: taskId, content: 'Looks good (smoke test)' });
  ok(!comment.isError && comment.data.comment.id, 'add_comment on a task', comment.text);

  const got = await tool(access, 'get_task', { task_id: taskId });
  ok(!got.isError && got.data.comments.length === 1 && got.data.task.content === 'Updated copy #smoketest', 'get_task shows content and comment', got.text);

  const proj = await tool(access, 'get_project', { project_id: projectId });
  ok(!proj.isError && proj.data.tasks.length === 2, 'get_project lists its tasks', proj.text);

  const camp = await tool(access, 'get_campaign', { campaign_id: campaignId });
  ok(!camp.isError && camp.data.projects[0].task_counts.total === 2, 'get_campaign shows task counts', camp.text);

  const del = await tool(access, 'delete_task', { task_id: taskId });
  ok(!del.isError, 'delete_task', del.text);

  const missing = await tool(access, 'get_task', { task_id: taskId });
  ok(missing.isError && /404/.test(missing.text), 'deleted task is gone (404)', missing.text);

  // --- Token used directly on the REST API --------------------------------------
  const api = await request('GET', `${BASE}/api/campaigns?limit=1`, { headers: { Authorization: `Bearer ${access}` } });
  ok(api.status === 200 && api.json?.success, 'bearer token works on the REST API');
  const blocked = await request('GET', `${BASE}/api/connected-apps`, { headers: { Authorization: `Bearer ${access}` } });
  ok(blocked.status === 403, 'tokens cannot manage connected apps', blocked.json);

  // --- Refresh + revoke ------------------------------------------------------------
  const refreshed = await request('POST', asm.json.token_endpoint, formBody({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId }));
  ok(refreshed.status === 200 && refreshed.json?.access_token && refreshed.json.refresh_token !== refresh, 'refresh token rotation', refreshed.json);
  const reused = await request('POST', asm.json.token_endpoint, formBody({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId }));
  ok(reused.status === 400 && reused.json?.error === 'invalid_grant', 'old refresh token is refused', reused.json);
  const oldStillOk = await mcp(access, 'ping');
  ok(oldStillOk.status === 200, 'previous access token keeps working until it expires');
  access = refreshed.json.access_token;
  refresh = refreshed.json.refresh_token;

  // Clean up the test campaign (archived, like "delete" in the app).
  const archived = await tool(access, 'archive_campaign', { campaign_id: campaignId });
  ok(!archived.isError && archived.data.campaign.archived === true, 'archive_campaign (cleanup)', archived.text);

  const revoke = await request('POST', asm.json.revocation_endpoint, formBody({ token: refresh, client_id: clientId }));
  ok(revoke.status === 200, 'token revocation');
  const afterRevoke = await mcp(access, 'ping');
  ok(afterRevoke.status === 401, 'revoked access token is refused', afterRevoke.status);

  console.log(`\nAll ${step} checks passed. The connector is ready for Claude at ${BASE}/mcp`);
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error?.message || error);
  process.exit(1);
});
