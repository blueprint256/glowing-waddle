/**
 * Self-test for the Claude connector's dependency-free parts: OAuth helpers, argument validation,
 * the MCP JSON-RPC handler and every tool (run against a fake REST API on a random port).
 *
 *   npm run mcp:selftest
 *
 * Needs no database. Exits with code 1 if anything fails.
 */
import http from 'http';
import assert from 'assert/strict';
import { AddressInfo } from 'net';
import {
  verifyPkceS256,
  isValidCodeChallenge,
  isAcceptableRedirectUri,
  matchRedirectUri,
  resourceMatches,
  parseBasicAuth,
  getBearerToken,
  buildRedirect,
  randomToken,
  sha256
} from '../oauth/crypto';
import { validateArgs } from '../mcp/validate';
import { handlePost, handleMessage, LATEST_PROTOCOL_VERSION, JSONRPC } from '../mcp/protocol';
import { createApiClient, buildQuery, formatApiError } from '../mcp/apiClient';
import { TOOLS, ToolContext, SERVER_INSTRUCTIONS } from '../mcp/tools';

let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (error: any) {
    failures.push(`✗ ${name}\n    ${error?.message || error}`);
  }
}

// ---------------------------------------------------------------------------
// Fake REST API: records requests, answers from a route table
// ---------------------------------------------------------------------------
type Recorded = { method: string; path: string; query: Record<string, string>; body: any; headers: http.IncomingHttpHeaders };
const recorded: Recorded[] = [];
type Handler = (r: Recorded) => { status?: number; body: any };
const routes: Record<string, Handler> = {};

const ID = (n: number) => n.toString(16).padStart(24, '0');
const campaignDoc = (n: number, extra: any = {}) => ({
  _id: ID(n), name: `Campaign ${n}`, status: 'active', archived: false, startDate: '2026-11-01T00:00:00.000Z',
  createdBy: { _id: ID(900), firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }, createdAt: '2026-10-01T00:00:00.000Z', ...extra
});
const projectDoc = (n: number, campaign = 1, extra: any = {}) => ({
  _id: ID(n), name: `Project ${n}`, status: 'planning', campaignId: { _id: ID(campaign), name: `Campaign ${campaign}` }, assignments: [], ...extra
});
const taskDoc = (n: number, project = 10, extra: any = {}) => ({
  _id: ID(n), name: `Task ${n}`, status: 'Pending', taskDate: '2026-11-20T00:00:00.000Z', content: 'Post copy',
  projectId: { _id: ID(project), name: `Project ${project}` }, campaignId: { _id: ID(1), name: 'Campaign 1' }, ...extra
});

function startFakeApi(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://x');
      const raw = Buffer.concat(chunks).toString();
      const rec: Recorded = {
        method: req.method || 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: raw ? JSON.parse(raw) : undefined,
        headers: req.headers
      };
      recorded.push(rec);
      const key = `${rec.method} ${rec.path}`;
      const handler = routes[key] || Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(key))?.[1];
      const out = handler ? handler(rec) : { status: 404, body: { success: false, message: `No fake route for ${key}` } };
      res.writeHead(out.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function makeCtx(port: number, user: Partial<ToolContext['user']> = {}): ToolContext {
  return {
    api: createApiClient({
      baseUrl: `http://127.0.0.1:${port}`,
      accessToken: 'bpat_test',
      internalHeader: 'x-blueprint-internal',
      internalSecret: 'secret',
      userAgent: 'Blueprint MCP connector (Claude)'
    }),
    user: { id: ID(900), email: 'ada@example.com', name: 'Ada Lovelace', role: 'hybrid', accessMode: 'part_two', canUseAI: false, ...user },
    appUrl: 'http://localhost:3000'
  };
}

async function call(ctx: ToolContext, name: string, args: unknown, id: number | string = 1) {
  const res = await handlePost({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, { tools: TOOLS, ctx });
  return res.body as any;
}
const textOf = (body: any) => body.result.content[0].text as string;
const jsonOf = (body: any) => JSON.parse(textOf(body));
const lastReq = () => recorded[recorded.length - 1];

async function main() {
  // -------------------------------------------------------------------------
  // OAuth helpers
  // -------------------------------------------------------------------------
  await test('PKCE S256 matches RFC 7636 appendix B vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    assert.equal(isValidCodeChallenge(challenge), true);
    assert.equal(verifyPkceS256(verifier, challenge), true);
    assert.equal(verifyPkceS256(verifier + 'x', challenge), false);
    assert.equal(verifyPkceS256('short', challenge), false);
    assert.equal(verifyPkceS256(undefined, challenge), false);
  });
  await test('redirect URI acceptance', () => {
    assert.equal(isAcceptableRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
    assert.equal(isAcceptableRedirectUri('http://localhost:33418/callback'), true);
    assert.equal(isAcceptableRedirectUri('http://127.0.0.1/callback'), true);
    assert.equal(isAcceptableRedirectUri('http://evil.example.com/cb'), false);
    assert.equal(isAcceptableRedirectUri('https://claude.ai/cb#frag'), false);
    assert.equal(isAcceptableRedirectUri('javascript:alert(1)'), false);
    assert.equal(isAcceptableRedirectUri(42), false);
  });
  await test('redirect URI matching (exact; loopback ignores port)', () => {
    const reg = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'];
    assert.equal(matchRedirectUri(reg, 'https://claude.ai/api/mcp/auth_callback'), 'https://claude.ai/api/mcp/auth_callback');
    assert.equal(matchRedirectUri(reg, 'https://claude.ai/api/mcp/auth_callback/'), null);
    assert.equal(matchRedirectUri(reg, 'http://localhost:51234/callback'), 'http://localhost:51234/callback');
    assert.equal(matchRedirectUri(reg, 'http://127.0.0.1:51234/callback'), 'http://127.0.0.1:51234/callback');
    assert.equal(matchRedirectUri(reg, 'http://localhost:51234/other'), null);
    assert.equal(matchRedirectUri(reg, 'https://evil.example/api/mcp/auth_callback'), null);
  });
  await test('resource indicator matching', () => {
    const mcp = 'https://abc.trycloudflare.com/mcp';
    assert.equal(resourceMatches('https://abc.trycloudflare.com/mcp', mcp), true);
    assert.equal(resourceMatches('https://ABC.trycloudflare.com/mcp/', mcp), true);
    assert.equal(resourceMatches('https://abc.trycloudflare.com', mcp), true);
    assert.equal(resourceMatches('https://abc.trycloudflare.com/', mcp), true);
    assert.equal(resourceMatches('https://other.example.com/mcp', mcp), false);
    assert.equal(resourceMatches('not a url', mcp), false);
  });
  await test('basic auth / bearer parsing / redirect building / tokens', () => {
    const header = 'Basic ' + Buffer.from('bpc_abc:s%3Acret').toString('base64');
    assert.deepEqual(parseBasicAuth(header), { clientId: 'bpc_abc', clientSecret: 's:cret' });
    assert.equal(parseBasicAuth('Bearer x'), null);
    assert.equal(getBearerToken('Bearer bpat_abc-DEF_123'), 'bpat_abc-DEF_123');
    assert.equal(getBearerToken('bearer   bpat_x '), 'bpat_x');
    assert.equal(getBearerToken('Basic abc'), null);
    assert.equal(getBearerToken(undefined), null);
    const url = new URL(buildRedirect('https://claude.ai/api/mcp/auth_callback?x=1', { code: 'c', state: 's t', iss: 'https://h' }));
    assert.equal(url.searchParams.get('x'), '1');
    assert.equal(url.searchParams.get('state'), 's t');
    assert.equal(url.searchParams.get('code'), 'c');
    const t1 = randomToken('bpat_');
    assert.ok(t1.startsWith('bpat_') && t1.length > 40 && /^[A-Za-z0-9_-]+$/.test(t1));
    assert.notEqual(randomToken('x'), randomToken('x'));
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(getBearerToken(`Bearer ${t1}`), t1);
  });

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------
  await test('validateArgs covers required, enums, patterns, nulls, arrays, unknown fields', () => {
    const schema: any = {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', pattern: '^[a-f0-9]{24}$' },
        status: { type: 'string', enum: ['A', 'B'] },
        when: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', format: 'date-or-datetime' },
        n: { type: 'integer', minimum: 1, maximum: 5 },
        tags: { type: 'array', maxItems: 2, items: { type: 'string', minLength: 1 } }
      }
    };
    assert.deepEqual(validateArgs(schema, { id: ID(1) }), []);
    assert.deepEqual(validateArgs(schema, { id: ID(1), when: null, status: 'A', n: 3, tags: ['a'] }), []);
    assert.equal(validateArgs(schema, {}).length, 1);
    assert.match(validateArgs(schema, { id: 'nope' })[0], /invalid format/);
    assert.match(validateArgs(schema, { id: ID(1), status: 'C' })[0], /one of/);
    assert.match(validateArgs(schema, { id: ID(1), when: '2026-13-45' })[0], /not a valid date/);
    assert.match(validateArgs(schema, { id: ID(1), n: 1.5 })[0], /integer/);
    assert.match(validateArgs(schema, { id: ID(1), n: 9 })[0], /<= 5/);
    assert.equal(validateArgs(schema, { id: ID(1), tags: ['a', 'b', 'c'] }).length, 1);
    assert.match(validateArgs(schema, { id: ID(1), tags: [''] })[0], /must not be empty/);
    assert.match(validateArgs(schema, { id: ID(1), extra: 1 })[0], /not a recognised field/);
    assert.match(validateArgs(schema, 'x')[0], /must be object/);
  });

  // -------------------------------------------------------------------------
  // Protocol
  // -------------------------------------------------------------------------
  const server = await startFakeApi();
  const port = (server.address() as AddressInfo).port;
  const hybrid = makeCtx(port);
  const admin = makeCtx(port, { role: 'system_admin', accessMode: 'part_one', canUseAI: true });
  const partOne = makeCtx(port, { accessMode: 'part_one', canUseAI: true });

  await test('initialize negotiates the protocol version and returns instructions', async () => {
    const res = await handlePost(
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } },
      { tools: TOOLS, ctx: hybrid, instructions: SERVER_INSTRUCTIONS }
    );
    const body = res.body as any;
    assert.equal(res.status, 200);
    assert.equal(body.id, 0);
    assert.equal(body.result.protocolVersion, '2025-06-18');
    assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
    assert.equal(body.result.serverInfo.name, 'blueprint-campaigns');
    assert.ok(body.result.instructions.includes('Campaign → Projects → Tasks'));
    const unknown = (await handlePost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, { tools: TOOLS, ctx: hybrid })).body as any;
    assert.equal(unknown.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  });
  await test('notifications and client responses get 202 with no body', async () => {
    assert.deepEqual(await handlePost({ jsonrpc: '2.0', method: 'notifications/initialized' }, { tools: TOOLS, ctx: hybrid }), { status: 202 });
    assert.deepEqual(await handlePost({ jsonrpc: '2.0', id: 5, result: {} }, { tools: TOOLS, ctx: hybrid }), { status: 202 });
  });
  await test('ping, unknown method, invalid messages, batches', async () => {
    assert.deepEqual((await handleMessage({ jsonrpc: '2.0', id: 'a', method: 'ping' }, { tools: TOOLS, ctx: hybrid }))!.result, {});
    const nf = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, { tools: TOOLS, ctx: hybrid });
    assert.equal(nf!.error!.code, JSONRPC.METHOD_NOT_FOUND);
    const bad = await handlePost({ id: 1, method: 'ping' }, { tools: TOOLS, ctx: hybrid });
    assert.equal(bad.status, 400);
    assert.equal((bad.body as any).error.code, JSONRPC.INVALID_REQUEST);
    const badId = await handlePost({ jsonrpc: '2.0', id: { x: 1 }, method: 'ping' }, { tools: TOOLS, ctx: hybrid });
    assert.equal(badId.status, 400);
    const batch = await handlePost(
      [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'ping' }],
      { tools: TOOLS, ctx: hybrid }
    );
    assert.equal(batch.status, 200);
    assert.equal((batch.body as any[]).length, 2);
    assert.equal((await handlePost([], { tools: TOOLS, ctx: hybrid })).status, 400);
  });
  await test('tool definitions are well-formed and unique', () => {
    const names = new Set<string>();
    for (const t of TOOLS) {
      assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/, t.name);
      assert.ok(!names.has(t.name), `duplicate ${t.name}`);
      names.add(t.name);
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
      assert.ok(t.description.length > 20, t.name);
      for (const r of t.inputSchema.required || []) assert.ok(t.inputSchema.properties?.[r], `${t.name}: required ${r} missing`);
      assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
      assert.equal(typeof t.annotations.destructiveHint, 'boolean', t.name);
    }
    // JSON-serialisable schemas
    JSON.parse(JSON.stringify(TOOLS.map((t) => t.inputSchema)));
  });
  await test('tools/list filters by role and Part', async () => {
    const list = async (ctx: ToolContext) =>
      ((await handlePost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { tools: TOOLS, ctx })).body as any).result.tools.map((t: any) => t.name);
    const h = await list(hybrid);
    const a = await list(admin);
    const p1 = await list(partOne);
    assert.ok(!h.includes('list_users') && !h.includes('generate_campaign_content') && !h.includes('refine_task_description'));
    assert.ok(h.includes('create_task') && h.includes('get_calendar') && h.includes('add_comment'));
    assert.ok(a.includes('list_users') && a.includes('update_user') && a.includes('generate_campaign_content'));
    assert.ok(p1.includes('generate_campaign_content') && !p1.includes('list_users'));
    const tools = ((await handlePost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { tools: TOOLS, ctx: hybrid })).body as any).result.tools;
    const del = tools.find((t: any) => t.name === 'delete_task');
    assert.equal(del.annotations.destructiveHint, true);
    assert.equal(del.annotations.openWorldHint, false);
    assert.equal(del.annotations.title, 'Delete task');
  });
  await test('calling a hidden or unknown tool is a protocol error', async () => {
    const hidden = await call(hybrid, 'list_users', {});
    assert.equal(hidden.error.code, JSONRPC.INVALID_PARAMS);
    assert.match(hidden.error.message, /not available/);
    const unknown = await call(hybrid, 'drop_database', {});
    assert.match(unknown.error.message, /Unknown tool/);
  });
  await test('invalid arguments come back as a tool error Claude can fix', async () => {
    const before = recorded.length;
    const res = await call(hybrid, 'create_task', { project_id: 'abc', name: '' });
    assert.equal(res.result.isError, true);
    assert.match(textOf(res), /project_id has an invalid format/);
    assert.match(textOf(res), /name must not be empty/);
    assert.equal(recorded.length, before, 'no API call on invalid input');
    const res2 = await call(hybrid, 'create_task', { project_id: ID(10), name: 'x', priority: 'high' });
    assert.match(textOf(res2), /priority is not a recognised field/);
  });

  // -------------------------------------------------------------------------
  // Tools against the fake API
  // -------------------------------------------------------------------------
  routes['GET /api/auth/me'] = () => ({ body: { success: true, user: { id: ID(900), email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', role: 'hybrid', accessMode: 'part_two' } } });
  routes['GET /api/users/me/company-info'] = () => ({ body: { success: true, companyInfo: { companyName: 'Acme', brandTone: 'Warm' } } });
  routes['GET /api/campaigns'] = () => ({ body: { success: true, campaigns: [campaignDoc(1), campaignDoc(2)], pagination: { total: 2, page: 1, limit: 25, pages: 1 } } });
  routes['POST /api/campaigns'] = (r) => ({ status: 201, body: { success: true, message: 'Campaign created successfully', campaign: campaignDoc(3, { name: r.body.name, hashtags: r.body.hashtags }) } });
  routes[`GET /api/campaigns/${ID(1)}`] = () => ({ body: { success: true, campaign: campaignDoc(1) } });
  routes[`GET /api/campaigns/${ID(66)}`] = () => ({ status: 403, body: { success: false, message: 'Access denied: You can only view campaigns you created' } });
  routes['GET /api/projects'] = () => ({ body: { success: true, projects: [projectDoc(10), projectDoc(11)], pagination: { total: 2, page: 1, limit: 500, pages: 1 } } });
  routes['GET /api/tasks'] = () => ({
    body: {
      success: true,
      tasks: [taskDoc(100), taskDoc(101, 10, { status: 'Completed', taskDate: '2026-11-21T09:00:00.000Z' }), taskDoc(102, 11, { taskDate: null })],
      pagination: { total: 3, page: 1, limit: 50, pages: 1 }
    }
  });
  routes['POST /api/projects'] = (r) => ({ status: 201, body: { success: true, message: 'Project created successfully', project: projectDoc(12, 1, { name: r.body.name }) } });
  routes[`PUT /api/projects/${ID(12)}`] = (r) => ({ body: { success: true, message: 'Project updated successfully', project: projectDoc(12, 1, { status: r.body.status }) } });
  let taskCounter = 200;
  routes['POST /api/tasks'] = (r) =>
    r.body.name === 'fail-me'
      ? { status: 400, body: { success: false, message: 'Validation error', errors: [{ path: 'taskDate', msg: 'taskDate must be a valid date' }] } }
      : { status: 201, body: { success: true, message: 'Task created successfully', task: taskDoc(taskCounter++, 10, { name: r.body.name, content: r.body.content }) } };
  routes[`PUT /api/tasks/${ID(100)}`] = (r) => ({ body: { success: true, message: 'Task updated successfully', task: taskDoc(100, 10, r.body) } });
  routes[`DELETE /api/tasks/${ID(100)}`] = () => ({ body: { success: true, message: 'Task deleted successfully' } });
  routes[`GET /api/tasks/${ID(100)}`] = () => ({ body: { success: true, task: taskDoc(100) } });
  routes['GET /api/comments'] = () => ({ body: { success: true, comments: [{ _id: ID(500), content: 'Looks good', authorId: { _id: ID(900), firstName: 'Ada', lastName: 'Lovelace' }, createdAt: '2026-11-02T00:00:00.000Z' }] } });
  routes['POST /api/comments'] = (r) => ({ status: 201, body: { success: true, message: 'Comment created successfully', comment: { _id: ID(501), content: r.body.content, authorId: { _id: ID(900), firstName: 'Ada', lastName: 'Lovelace' } } } });
  routes[`PUT /api/campaigns/${ID(1)}/unarchive`] = () => ({ body: { success: true, message: 'Campaign restored successfully', campaign: campaignDoc(1) } });
  routes['GET /api/users'] = () => ({ body: { success: true, users: [{ _id: ID(901), email: 'bo@example.com', firstName: 'Bo', lastName: 'B', role: 'hybrid', accessMode: 'part_two', mcpEnabled: false, isActive: true }], pagination: { total: 1, page: 1, limit: 50, pages: 1 } } });
  routes[`PUT /api/users/${ID(901)}`] = (r) => ({ body: { success: true, message: 'User updated successfully', user: { id: ID(901), email: 'bo@example.com', firstName: 'Bo', lastName: 'B', role: 'hybrid', accessMode: r.body.accessMode ?? 'part_two', mcpEnabled: r.body.mcpEnabled, isActive: true } } });

  await test('get_my_account combines profile, part and company info; sends auth headers', async () => {
    const data = jsonOf(await call(hybrid, 'get_my_account', {}));
    assert.equal(data.email, 'ada@example.com');
    assert.equal(data.part, 'part_two');
    assert.equal(data.ai_generation_available, false);
    assert.equal(data.company_info.companyName, 'Acme');
    const req = recorded.find((r) => r.path === '/api/auth/me')!;
    assert.equal(req.headers.authorization, 'Bearer bpat_test');
    assert.equal(req.headers['x-blueprint-internal'], 'secret');
    assert.equal(req.headers['user-agent'], 'Blueprint MCP connector (Claude)');
  });
  await test('list_campaigns maps filters to API query and shapes output', async () => {
    const data = jsonOf(await call(hybrid, 'list_campaigns', { status: ['active', 'draft'], include_archived: true, date_to: '2026-12-31', search: 'launch' }));
    const q = lastReq().query;
    assert.equal(q.status, 'active,draft');
    assert.equal(q.includeArchived, 'true');
    assert.equal(q.dateTo, '2026-12-31T23:59:59.999Z');
    assert.equal(q.search, 'launch');
    assert.equal(q.limit, '25');
    assert.equal(data.campaigns.length, 2);
    assert.equal(data.campaigns[0].id, ID(1));
    assert.equal(data.campaigns[0].url, `http://localhost:3000/campaigns/${ID(1)}`);
    assert.equal(data.campaigns[0].created_by.name, 'Ada Lovelace');
    assert.equal(data.pagination.total, 2);
  });
  await test('get_campaign aggregates projects and task counts', async () => {
    const data = jsonOf(await call(hybrid, 'get_campaign', { campaign_id: ID(1) }));
    assert.equal(data.campaign.name, 'Campaign 1');
    assert.equal(data.projects.length, 2);
    assert.deepEqual(data.projects[0].task_counts, { total: 2, Pending: 1, 'In Progress': 0, Completed: 1 });
    assert.equal(data.projects[1].task_counts.total, 1);
    assert.equal(data.total_tasks, 3);
  });
  await test('API permission errors surface as tool errors with the API message', async () => {
    const res = await call(hybrid, 'get_campaign', { campaign_id: ID(66) });
    assert.equal(res.result.isError, true);
    assert.equal(textOf(res), 'Error (HTTP 403): Access denied: You can only view campaigns you created');
  });
  await test('create_campaign sends camelCase body', async () => {
    const data = jsonOf(await call(hybrid, 'create_campaign', { name: 'Black Friday', hashtags: ['#bf'], start_date: '2026-11-20', core_messages: 'Save big' }));
    assert.deepEqual(lastReq().body, { name: 'Black Friday', hashtags: ['#bf'], startDate: '2026-11-20', coreMessages: 'Save big' });
    assert.equal(data.campaign.name, 'Black Friday');
  });
  await test('update_campaign refuses an empty update without calling the API', async () => {
    const before = recorded.length;
    const res = await call(hybrid, 'update_campaign', { campaign_id: ID(1) });
    assert.equal(res.result.isError, true);
    assert.match(textOf(res), /Nothing to update/);
    assert.equal(recorded.length, before);
  });
  await test('create_project applies a non-default status with a follow-up update', async () => {
    const data = jsonOf(await call(hybrid, 'create_project', { campaign_id: ID(1), name: 'Socials', status: 'in_progress' }));
    const reqs = recorded.slice(-2);
    assert.equal(reqs[0].method, 'POST');
    assert.deepEqual(reqs[0].body, { campaignId: ID(1), name: 'Socials' });
    assert.equal(reqs[1].method, 'PUT');
    assert.deepEqual(reqs[1].body, { status: 'in_progress' });
    assert.equal(data.project.status, 'in_progress');
  });
  await test('create_task / update_task / delete_task', async () => {
    const created = jsonOf(await call(hybrid, 'create_task', { project_id: ID(10), name: 'Teaser', content: 'Coming soon', task_date: '2026-11-25', status: 'Pending' }));
    assert.deepEqual(lastReq().body, { projectId: ID(10), name: 'Teaser', content: 'Coming soon', taskDate: '2026-11-25', status: 'Pending' });
    assert.equal(created.task.name, 'Teaser');
    assert.ok(created.task.url.startsWith('http://localhost:3000/tasks/'));
    const updated = jsonOf(await call(hybrid, 'update_task', { task_id: ID(100), status: 'Completed', task_date: null }));
    assert.deepEqual(lastReq().body, { status: 'Completed', taskDate: null });
    assert.equal(updated.task.status, 'Completed');
    const deleted = jsonOf(await call(hybrid, 'delete_task', { task_id: ID(100) }));
    assert.equal(lastReq().method, 'DELETE');
    assert.equal(deleted.message, 'Task deleted successfully');
  });
  await test('create_tasks reports per-item results and validation details', async () => {
    const data = jsonOf(await call(hybrid, 'create_tasks', { project_id: ID(10), tasks: [{ name: 'A' }, { name: 'fail-me' }, { name: 'C', content: 'x' }] }));
    assert.equal(data.message, 'Created 2 of 3 task(s)');
    assert.equal(data.results[1].created, false);
    assert.equal(data.results[1].error, 'Validation error (taskDate: taskDate must be a valid date)');
    assert.equal(data.results[2].task.content, 'x');
  });
  await test('get_calendar groups by UTC day and validates the range', async () => {
    const data = jsonOf(await call(hybrid, 'get_calendar', { date_from: '2026-11-01', date_to: '2026-11-30' }));
    const q = lastReq().query;
    assert.equal(q.dateFrom, '2026-11-01T00:00:00.000Z');
    assert.equal(q.dateTo, '2026-11-30T23:59:59.999Z');
    assert.deepEqual(Object.keys(data.days).sort(), ['2026-11-20', '2026-11-21', 'undated']);
    const bad = await call(hybrid, 'get_calendar', { date_from: '2026-11-30', date_to: '2026-11-01' });
    assert.equal(bad.result.isError, true);
    const tooLong = await call(hybrid, 'get_calendar', { date_from: '2026-01-01', date_to: '2027-06-01' });
    assert.match(textOf(tooLong), /at most one year/);
  });
  await test('get_task includes comments fetched by taskId', async () => {
    const data = jsonOf(await call(hybrid, 'get_task', { task_id: ID(100) }));
    assert.equal(data.task.id, ID(100));
    assert.equal(data.comments[0].author.name, 'Ada Lovelace');
    assert.ok(recorded.some((r) => r.path === '/api/comments' && r.query.taskId === ID(100)));
  });
  await test('add_comment maps the target type to the right field', async () => {
    await call(hybrid, 'add_comment', { target_type: 'task', target_id: ID(100), content: 'Approved' });
    assert.deepEqual(lastReq().body, { content: 'Approved', taskId: ID(100) });
    await call(hybrid, 'add_comment', { target_type: 'campaign', target_id: ID(1), content: 'Hi', reply_to_comment_id: ID(500) });
    assert.deepEqual(lastReq().body, { content: 'Hi', campaignId: ID(1), parentCommentId: ID(500) });
  });
  await test('restore_campaign calls the unarchive endpoint', async () => {
    const data = jsonOf(await call(hybrid, 'restore_campaign', { campaign_id: ID(1) }));
    assert.equal(lastReq().path, `/api/campaigns/${ID(1)}/unarchive`);
    assert.equal(data.message, 'Campaign restored successfully');
  });
  await test('admin user tools map part / connector fields', async () => {
    const list = jsonOf(await call(admin, 'list_users', {}));
    assert.equal(list.users[0].claude_connector_enabled, false);
    assert.equal(list.users[0].part, 'part_two');
    const upd = jsonOf(await call(admin, 'update_user', { user_id: ID(901), claude_connector_enabled: true, part: 'part_one' }));
    assert.deepEqual(lastReq().body, { accessMode: 'part_one', mcpEnabled: true });
    assert.equal(upd.user.claude_connector_enabled, true);
    const self = await call(admin, 'deactivate_user', { user_id: ID(900) });
    assert.match(textOf(self), /cannot deactivate your own account/);
  });
  await test('unreachable API gives a clear tool error', async () => {
    const dead = makeCtx(1);
    const res = await call(dead, 'list_campaigns', {});
    assert.equal(res.result.isError, true);
    assert.match(textOf(res), /Could not reach the app API/);
  });
  await test('buildQuery / formatApiError helpers', () => {
    assert.equal(buildQuery({ a: 'x y', b: undefined, c: ['1', '2'], d: '', e: 0 }), '?a=x+y&c=1%2C2&e=0');
    assert.equal(formatApiError(403, { message: 'No', code: 'AI_GENERATION_DISABLED' }), 'No [AI_GENERATION_DISABLED]');
    assert.equal(formatApiError(500, undefined), 'Request failed with HTTP 500');
  });

  server.close();

  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`MCP connector self-test: all ${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
