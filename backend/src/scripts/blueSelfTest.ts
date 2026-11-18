/**
 * Self-test for Blue (no database, no network): provider request/response formats, the agent loop
 * with tool execution and confirmations, the system prompt and the transcript.
 *
 *   npm run blue:selftest
 */
import http from 'http';
import assert from 'assert/strict';
import { AddressInfo } from 'net';
import {
  toAnthropicMessages,
  toOpenAIMessages,
  parseAnthropicResponse,
  parseOpenAIResponse,
  buildAnthropicRequest,
  buildOpenAIRequest,
  sanitizeSchema,
  createAnthropicProvider,
  createOpenAICompatibleProvider,
  ProviderError,
  FetchLike
} from '../blue/providers';
import { runAgent, executeCall, declinedResults, trimHistory, toolSpecs } from '../blue/agent';
import { buildSystemPrompt, formatToday, describePage } from '../blue/prompt';
import { toTranscript, titleFrom } from '../blue/transcript';
import type { BlueEvent, ChatProvider, NeutralMessage, ProviderTurn } from '../blue/types';
import { createApiClient } from '../mcp/apiClient';
import { TOOLS, ToolContext } from '../mcp/tools';

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

const ID = (n: number) => n.toString(16).padStart(24, '0');

// Fake app API ---------------------------------------------------------------
type Rec = { method: string; path: string; body: any; headers: http.IncomingHttpHeaders };
const recorded: Rec[] = [];
function startFakeApi(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://x');
      const raw = Buffer.concat(chunks).toString();
      const rec = { method: req.method || 'GET', path: url.pathname, body: raw ? JSON.parse(raw) : undefined, headers: req.headers };
      recorded.push(rec);
      let status = 200;
      let body: any = { success: true };
      if (rec.method === 'GET' && rec.path === '/api/campaigns') {
        body = { success: true, campaigns: [{ _id: ID(1), name: 'Shoe sale', status: 'active' }], pagination: { total: 1, page: 1, limit: 25, pages: 1 } };
      } else if (rec.method === 'POST' && rec.path === '/api/tasks') {
        body = { success: true, message: 'Post created', task: { _id: ID(100), name: rec.body.name, status: 'Draft', taskDate: rec.body.taskDate, campaignId: { _id: ID(1), name: 'Shoe sale' } } };
        status = 201;
      } else if (rec.method === 'GET' && rec.path === `/api/tasks/${ID(100)}`) {
        body = { success: true, task: { _id: ID(100), name: 'Friday shoe sale post', status: 'Draft' } };
      } else if (rec.method === 'DELETE' && rec.path === `/api/tasks/${ID(100)}`) {
        body = { success: true, message: 'Task deleted successfully' };
      } else {
        status = 404;
        body = { success: false, message: `No fake route ${rec.method} ${rec.path}` };
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function makeCtx(port: number, over: Partial<ToolContext['user']> = {}): ToolContext {
  return {
    api: createApiClient({
      baseUrl: `http://127.0.0.1:${port}`,
      actAsUserId: ID(900),
      actAsHeader: 'x-blueprint-act-as',
      internalHeader: 'x-blueprint-internal',
      internalSecret: 'secret',
      userAgent: 'Blue assistant'
    }),
    user: { id: ID(900), email: 'ada@example.com', name: 'Ada Lovelace', role: 'hybrid', accessMode: 'part_two', canUseAI: false, canUseLibrary: true, ...over },
    appUrl: 'http://localhost:3000'
  };
}

/** Scripted provider: returns the given turns in order and records what it was sent. */
function scripted(turns: (ProviderTurn | Error)[]) {
  const seen: { messages: NeutralMessage[]; toolNames: string[] }[] = [];
  const provider: ChatProvider = {
    provider: 'anthropic',
    model: 'test-model',
    async complete({ messages, tools }) {
      seen.push({ messages: JSON.parse(JSON.stringify(messages)), toolNames: tools.map((t) => t.name) });
      const next = turns.shift();
      if (!next) throw new Error('No scripted turn left');
      if (next instanceof Error) throw next;
      return next;
    }
  };
  return { provider, seen };
}

const turn = (text: string, toolCalls: ProviderTurn['toolCalls'] = []): ProviderTurn => ({ text, toolCalls, usage: { input: 100, output: 20 } });

async function main() {
  // -------------------------------------------------------------------------
  // Provider formats
  // -------------------------------------------------------------------------
  const history: NeutralMessage[] = [
    { role: 'user', text: 'Create a task for shoe sales on Friday' },
    { role: 'assistant', text: 'Let me find the campaign.', toolCalls: [{ id: 'toolu_1', name: 'list_campaigns', args: { search: 'shoe' } }] },
    { role: 'tool', results: [{ id: 'toolu_1', name: 'list_campaigns', content: '{"campaigns":[]}', isError: false }] },
    { role: 'tool', results: [{ id: 'toolu_2', name: 'delete_task', content: 'The user pressed Cancel.', isError: true }] },
    { role: 'user', text: 'Thanks' },
    { role: 'assistant', text: '' }
  ];

  await test('Anthropic: messages merge consecutive user turns, tool results first', () => {
    const out = toAnthropicMessages(history);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.deepEqual(out[1].content[1], { type: 'tool_use', id: 'toolu_1', name: 'list_campaigns', input: { search: 'shoe' } });
    assert.deepEqual(out[2].content.map((b: any) => b.type), ['tool_result', 'tool_result', 'text']);
    assert.equal(out[2].content[1].is_error, true);
    assert.equal(out[2].content[0].is_error, undefined);
  });
  await test('Anthropic: request has cached system + tools and sanitized schemas', () => {
    const specs = toolSpecs(TOOLS, makeCtx(1));
    const req: any = buildAnthropicRequest('claude-haiku-5-5', 'SYS', history, specs);
    assert.equal(req.max_tokens, 4096);
    assert.equal(req.system[0].cache_control.type, 'ephemeral');
    assert.equal(req.tools[req.tools.length - 1].cache_control.type, 'ephemeral');
    assert.equal(req.tools[0].cache_control, undefined);
    assert.ok(!JSON.stringify(req.tools).includes('"format"'));
    assert.ok(req.tools.every((t: any) => t.input_schema.type === 'object'));
  });
  await test('Anthropic: response parsing (text + tool_use + cached usage)', () => {
    const t = parseAnthropicResponse({
      content: [{ type: 'text', text: 'Creating it.' }, { type: 'tool_use', id: 'toolu_9', name: 'create_task', input: { name: 'x' } }],
      usage: { input_tokens: 50, cache_read_input_tokens: 1000, output_tokens: 30 }
    });
    assert.equal(t.text, 'Creating it.');
    assert.deepEqual(t.toolCalls, [{ id: 'toolu_9', name: 'create_task', args: { name: 'x' } }]);
    assert.deepEqual(t.usage, { input: 1050, output: 30 });
  });
  await test('OpenAI: messages, tool call arguments and tool results', () => {
    const out = toOpenAIMessages('SYS', history);
    assert.equal(out[0].role, 'system');
    assert.equal(out[2].tool_calls[0].function.arguments, '{"search":"shoe"}');
    assert.deepEqual(out.slice(3, 5).map((m) => [m.role, m.tool_call_id]), [['tool', 'toolu_1'], ['tool', 'toolu_2']]);
    assert.equal(out[out.length - 1].content, 'Thanks'); // empty assistant turn dropped
    const req: any = buildOpenAIRequest('gpt-4o-mini', 'SYS', history, toolSpecs(TOOLS, makeCtx(1)));
    assert.equal(req.tool_choice, 'auto');
    assert.equal(req.tools[0].type, 'function');
    assert.equal(req.max_tokens, undefined);
  });
  await test('OpenAI: response parsing tolerates bad JSON arguments', () => {
    const t = parseOpenAIResponse({
      choices: [{ message: { content: null, tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'list_tasks', arguments: '{"status":["Draft"]}' } },
        { id: 'call_2', type: 'function', function: { name: 'get_task', arguments: '{oops' } }
      ] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    });
    assert.equal(t.text, '');
    assert.deepEqual(t.toolCalls[0].args, { status: ['Draft'] });
    assert.deepEqual(t.toolCalls[1].args, {});
    assert.deepEqual(t.usage, { input: 10, output: 5 });
  });
  await test('sanitizeSchema strips format/default only', () => {
    const s: any = sanitizeSchema({ type: 'object', properties: { d: { type: 'string', format: 'date-or-datetime', pattern: 'x', default: 'a' } } });
    assert.deepEqual(s, { type: 'object', properties: { d: { type: 'string', pattern: 'x' } } });
  });
  await test('providers call the right endpoints with auth headers and surface API errors', async () => {
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const okFetch: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const body = url.includes('anthropic')
        ? { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 } }
        : { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const msgs: NeutralMessage[] = [{ role: 'user', text: 'hello' }];
    await createAnthropicProvider({ apiKey: 'ak', model: 'm', fetchImpl: okFetch }).complete({ system: 's', messages: msgs, tools: [] });
    await createOpenAICompatibleProvider({ provider: 'openai', apiKey: 'ok', model: 'm', fetchImpl: okFetch }).complete({ system: 's', messages: msgs, tools: [] });
    await createOpenAICompatibleProvider({ provider: 'grok', apiKey: 'gk', model: 'g', fetchImpl: okFetch }).complete({ system: 's', messages: msgs, tools: [] });
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(calls[0].headers['x-api-key'], 'ak');
    assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(calls[1].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[1].headers.Authorization, 'Bearer ok');
    assert.equal(calls[2].url, 'https://api.x.ai/v1/chat/completions');
    assert.equal(calls[0].body.tools, undefined);

    const badFetch: FetchLike = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'model: not found' } }) });
    await assert.rejects(
      createAnthropicProvider({ apiKey: 'ak', model: 'nope', fetchImpl: badFetch }).complete({ system: 's', messages: msgs, tools: [] }),
      (e: any) => e instanceof ProviderError && e.status === 404 && /model: not found/.test(e.message)
    );
    const downFetch: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      createOpenAICompatibleProvider({ provider: 'openai', apiKey: 'k', model: 'm', fetchImpl: downFetch }).complete({ system: 's', messages: msgs, tools: [] }),
      (e: any) => e instanceof ProviderError && e.status === 502
    );
  });

  // -------------------------------------------------------------------------
  // Agent loop against the fake API
  // -------------------------------------------------------------------------
  const server = await startFakeApi();
  const port = (server.address() as AddressInfo).port;
  const ctx = makeCtx(port);

  await test('agent: finds the campaign, creates the post, replies; tools run as the user', async () => {
    const { provider, seen } = scripted([
      turn('', [{ id: 't1', name: 'list_campaigns', args: { search: 'shoe' } }]),
      turn('', [{ id: 't2', name: 'create_task', args: { campaign_id: ID(1), name: 'Friday shoe sale post', task_date: '2026-11-20', content: 'Step into the weekend!' } }]),
      turn('Done: I added “Friday shoe sale post” to the Shoe sale campaign for Friday 20 Nov.')
    ]);
    const events: BlueEvent[] = [];
    const result = await runAgent({ provider, system: 'SYS', messages: [{ role: 'user', text: 'Create a task for shoe sales on Friday' }], tools: TOOLS, ctx, onEvent: (e) => events.push(e) });
    assert.equal(result.pending, null);
    assert.equal(result.steps, 3);
    assert.deepEqual(result.usage, { input: 300, output: 60 });
    assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
    assert.deepEqual(events.map((e) => e.type), ['tool_start', 'tool_result', 'tool_start', 'tool_result', 'assistant_text']);
    const created: any = events.find((e) => e.type === 'tool_result' && e.name === 'create_task');
    assert.equal(created.ok, true);
    assert.equal(created.data.task.name, 'Friday shoe sale post');
    const post = recorded.find((r) => r.method === 'POST' && r.path === '/api/tasks')!;
    assert.equal(post.headers['x-blueprint-act-as'], ID(900));
    assert.equal(post.headers['x-blueprint-internal'], 'secret');
    assert.equal(post.headers.authorization, undefined);
    assert.ok(!seen[0].toolNames.includes('list_users'), 'admin tools hidden for hybrid users');
    assert.ok(!seen[0].toolNames.includes('generate_campaign_content'), 'AI tools hidden for Part two');
  });

  await test('agent: destructive tool pauses for confirmation and is not executed', async () => {
    const before = recorded.filter((r) => r.method === 'DELETE').length;
    const { provider } = scripted([turn('I’ll delete it.', [{ id: 'd1', name: 'delete_task', args: { task_id: ID(100) } }])]);
    const events: BlueEvent[] = [];
    const result = await runAgent({
      provider, system: 'SYS', messages: [{ role: 'user', text: 'delete that task' }], tools: TOOLS, ctx,
      onEvent: (e) => events.push(e),
      describeAction: async (call) => `Delete task ${call.args.task_id}`
    });
    assert.ok(result.pending);
    assert.equal(result.pending!.calls[0].name, 'delete_task');
    assert.deepEqual(result.pending!.summaries, [`Delete task ${ID(100)}`]);
    assert.equal(recorded.filter((r) => r.method === 'DELETE').length, before, 'nothing deleted yet');
    assert.equal(events[events.length - 1].type, 'confirm');
    assert.equal(result.messages[result.messages.length - 1].role, 'assistant');

    // Approve: run the pending call, then the model continues.
    const events2: BlueEvent[] = [];
    const res = await executeCall(result.pending!.calls[0], TOOLS, ctx, (e) => events2.push(e));
    assert.equal(res.isError, false);
    assert.equal(recorded.filter((r) => r.method === 'DELETE').length, before + 1);
    const { provider: p2, seen } = scripted([turn('Deleted.')]);
    const cont = await runAgent({ provider: p2, system: 'SYS', messages: [...result.messages, { role: 'tool', results: [res] }], tools: TOOLS, ctx, onEvent: () => undefined });
    assert.equal(cont.pending, null);
    const anth = toAnthropicMessages(seen[0].messages);
    assert.equal(anth[anth.length - 1].content[0].type, 'tool_result');
    assert.equal(anth[anth.length - 1].content[0].tool_use_id, 'd1');
  });

  await test('agent: mixed turn runs safe tools now, holds the destructive one', async () => {
    const { provider } = scripted([turn('', [
      { id: 'a', name: 'list_campaigns', args: {} },
      { id: 'b', name: 'delete_task', args: { task_id: ID(100) } }
    ])]);
    const result = await runAgent({ provider, system: 'SYS', messages: [{ role: 'user', text: 'x' }], tools: TOOLS, ctx, onEvent: () => undefined });
    const toolMsg = result.messages.find((m) => m.role === 'tool') as any;
    assert.deepEqual(toolMsg.results.map((r: any) => r.id), ['a']);
    assert.deepEqual(result.pending!.calls.map((c) => c.id), ['b']);
    // Declining produces paired tool results so the history stays valid for every provider.
    const declined: any = declinedResults(result.pending!, 'Cancelled');
    const msgs = [...result.messages, declined, { role: 'user', text: 'never mind' } as NeutralMessage];
    const anth = toAnthropicMessages(msgs);
    const lastUser = anth[anth.length - 1];
    assert.deepEqual(lastUser.content.map((b: any) => b.type), ['tool_result', 'tool_result', 'text']);
    const oa = toOpenAIMessages('S', msgs);
    assert.deepEqual(oa.slice(-3).map((m) => m.role), ['tool', 'tool', 'user']);
  });

  await test('agent: invalid args and unknown/hidden tools become errors the model sees', async () => {
    const { provider, seen } = scripted([
      turn('', [{ id: 'x1', name: 'create_task', args: { campaign_id: 'nope' } }, { id: 'x2', name: 'list_users', args: {} }]),
      turn('I need the campaign first.')
    ]);
    const events: BlueEvent[] = [];
    await runAgent({ provider, system: 'SYS', messages: [{ role: 'user', text: 'x' }], tools: TOOLS, ctx, onEvent: (e) => events.push(e) });
    const toolMsg: any = seen[1].messages.find((m) => m.role === 'tool');
    assert.match(toolMsg.results[0].content, /campaign_id has an invalid format/);
    assert.match(toolMsg.results[1].content, /not available/);
    assert.ok(toolMsg.results.every((r: any) => r.isError));
  });

  await test('agent: stops after maxSteps and on provider errors keeps progress', async () => {
    const loops = Array.from({ length: 5 }, (_, i) => turn('', [{ id: `l${i}`, name: 'list_campaigns', args: {} }]));
    const { provider } = scripted(loops);
    const r = await runAgent({ provider, system: 'S', messages: [{ role: 'user', text: 'x' }], tools: TOOLS, ctx, onEvent: () => undefined, maxSteps: 3 });
    assert.equal(r.steps, 3);
    assert.match((r.messages[r.messages.length - 1] as any).text, /stopped after 3 steps/);

    const { provider: p2 } = scripted([turn('', [{ id: 'e1', name: 'list_campaigns', args: {} }]), new Error('provider down')]);
    const r2 = await runAgent({ provider: p2, system: 'S', messages: [{ role: 'user', text: 'x' }], tools: TOOLS, ctx, onEvent: () => undefined });
    assert.ok(r2.error);
    assert.deepEqual(r2.messages.map((m) => m.role), ['user', 'assistant', 'tool']);
  });

  await test('agent: Part one users get AI tools', async () => {
    const { provider, seen } = scripted([turn('hi')]);
    await runAgent({ provider, system: 'S', messages: [{ role: 'user', text: 'x' }], tools: TOOLS, ctx: makeCtx(port, { accessMode: 'part_one', canUseAI: true }), onEvent: () => undefined });
    assert.ok(seen[0].toolNames.includes('generate_campaign_content'));
  });

  server.close();

  // -------------------------------------------------------------------------
  // Prompt, transcript, trimming
  // -------------------------------------------------------------------------
  await test('prompt: today in the user time zone, page context, Part rules', () => {
    const now = new Date('2026-11-16T22:30:00Z'); // 01:30 on the 17th in Kampala
    assert.equal(formatToday('Africa/Kampala', now).iso, '2026-11-17');
    assert.equal(formatToday('Not/AZone', now).zone, 'UTC');
    assert.match(describePage(`/tasks/${ID(5)}`)!, /post with id/);
    assert.match(describePage(`/posts/${ID(5)}`)!, /post with id .*get_task/);
    assert.equal(describePage(`/projects/${ID(6)}`), null, 'themes are retired');
    assert.match(describePage(`/planner?view=month&post=${ID(7)}`)!, new RegExp(`post with id ${ID(7)} open`));
    assert.match(describePage(`/campaigns/${ID(8)}`)!, /campaign with id .*get_campaign/);
    assert.match(describePage('/planner?campaign=none')!, /without a campaign/);
    assert.match(describePage('/calendar')!, /Planner/);
    assert.match(describePage('/settings/brand')!, /Settings/);
    assert.equal(describePage('/nope'), null);
    const p = buildSystemPrompt({ user: { name: 'Ada', role: 'hybrid', part: 'part_two', canUseAI: false }, timeZone: 'Africa/Kampala', path: '/calendar', now });
    assert.match(p, /Tuesday,? 17 November 2026/);
    assert.match(p, /isn't included in their plan/);
    assert.match(p, /Confirm and Cancel buttons/);
  });
  await test('transcript: user/assistant/tool items and pending confirm', () => {
    const items = toTranscript(
      [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'ok', toolCalls: [{ id: '1', name: 'list_tasks', args: {} }] },
        { role: 'tool', results: [{ id: '1', name: 'list_tasks', content: '{"tasks":[]}', isError: false }, { id: '2', name: 'x', content: 'boom', isError: true }] }
      ],
      { calls: [{ id: '3', name: 'delete_task', args: {} }], summaries: ['Delete task'], createdAt: 'now' }
    );
    assert.deepEqual(items.map((i) => i.kind), ['user', 'assistant', 'tool', 'tool', 'confirm']);
    assert.deepEqual((items[2] as any).data, { tasks: [] });
    assert.equal((items[3] as any).error, 'boom');
    assert.equal(titleFrom('  Create   a task '), 'Create a task');
    assert.equal(titleFrom('x'.repeat(80)).length, 58);
  });
  await test('trimHistory keeps tool calls paired and starts at a user turn', () => {
    const big = 'y'.repeat(1000);
    const msgs: NeutralMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'user', text: `q${i} ${big}` });
      msgs.push({ role: 'assistant', toolCalls: [{ id: `c${i}`, name: 'list_tasks', args: {} }] });
      msgs.push({ role: 'tool', results: [{ id: `c${i}`, name: 'list_tasks', content: big, isError: false }] });
    }
    const trimmed = trimHistory(msgs, 7000);
    assert.equal(trimmed[0].role, 'user');
    assert.ok(trimmed.length < msgs.length && trimmed.length % 3 === 0);
    assert.deepEqual(trimHistory(msgs.slice(0, 3), 1_000_000), msgs.slice(0, 3));
  });

  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`Blue self-test: all ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
