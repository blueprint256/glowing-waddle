/**
 * Inbox self-test: understanding typed replies, audience targeting and the assistant tools.
 * Needs no database or network.   npm run inbox:selftest
 */
import assert from 'assert/strict';
import { matchIntent, parseIntentReply, intentPrompt, primaryAction } from '../inbox/intents';
import { cleanAudience, audienceQuery, describeAudience } from '../inbox/audience';

const failures: string[] = [];
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e: any) {
    failures.push(`✗ ${name}: ${e?.message || e}`);
  }
}

const upcoming = [
  { id: 'publish_now', label: 'Publish now', style: 'primary' },
  { id: 'keep', label: 'Keep the schedule', style: 'secondary' },
  { id: 'open', label: 'Open the task', link: '/tasks/1' }
];
const due = [
  { id: 'mark_posted', label: 'Mark as posted', style: 'primary' },
  { id: 'snooze', label: 'Remind me in an hour', style: 'secondary' },
  { id: 'open', label: 'Get the caption and files', link: '/publishing' }
];
const failed = [
  { id: 'retry', label: 'Try again', style: 'primary' },
  { id: 'cancel_post', label: "Don't post it", style: 'danger' }
];

async function main() {
  await test('Replies: yes / no / later / links / named actions', () => {
    assert.deepEqual(matchIntent('Yes', upcoming), { action: 'publish_now' });
    assert.deepEqual(matchIntent('ok, go ahead!', upcoming), { action: 'publish_now' });
    assert.deepEqual(matchIntent('no', upcoming), { action: 'keep' });
    assert.deepEqual(matchIntent('Not now', upcoming), { action: 'keep' });
    assert.deepEqual(matchIntent('remind me later', due), { action: 'snooze' });
    assert.deepEqual(matchIntent('posted it https://instagram.com/p/abc', due), { action: 'mark_posted', value: 'https://instagram.com/p/abc' });
    assert.deepEqual(matchIntent('yes', due), { action: 'mark_posted' });
    assert.deepEqual(matchIntent('try again', failed), { action: 'retry' });
    assert.deepEqual(matchIntent("Don't post it", failed), { action: 'cancel_post' }, 'a button label wins over "no"');
    assert.deepEqual(matchIntent('nope', failed), { action: 'dismiss' });
    assert.equal(matchIntent('what time is it scheduled for?', upcoming), null, 'questions go to the AI or the user');
    assert.equal(matchIntent('now', upcoming), null, '"now" is not "no"');
    assert.equal(matchIntent('   ', upcoming), null);
    assert.equal(primaryAction(upcoming)?.id, 'publish_now');
  });

  await test('Replies: AI fallback is restricted to the item’s own actions', () => {
    assert.deepEqual(parseIntentReply('{"action":"retry"}', failed), { action: 'retry', value: undefined });
    assert.deepEqual(parseIntentReply('Sure: {"action": "dismiss", "value": ""}', failed), { action: 'dismiss', value: undefined });
    assert.equal(parseIntentReply('{"action":"publish_now"}', failed), null, 'not offered by this item');
    assert.equal(parseIntentReply('{"action":"none"}', failed), null);
    assert.equal(parseIntentReply('no json here', failed), null);
    const p = intentPrompt({ title: 'Post failed', body: 'Token expired' }, [...failed, { id: 'open', label: 'Open', link: '/x' }], 'ok');
    assert.ok(p.includes('retry: Try again') && !p.includes('open: Open'), 'links are not offered to the AI');
  });

  await test('Audience: everyone, filters (AND), values (OR), chosen users always included', () => {
    assert.deepEqual(audienceQuery(cleanAudience({ everyone: true, sectors: ['x'] })), { isActive: { $ne: false } });
    const none = audienceQuery(cleanAudience({}));
    assert.deepEqual(none, { isActive: { $ne: false }, _id: { $in: [] } }, 'nothing chosen = nobody');
    const q: any = audienceQuery(cleanAudience({ sectors: ['Health ', 'Pharmacy'], tags: ['VIP'], accessModes: ['part_one'] }));
    assert.equal(q.$and.length, 3);
    assert.ok(q.$and[0].accessMode.$in.includes('part_one'));
    const sectorRe: RegExp[] = q.$and[1]['companyInfo.sector'].$in;
    assert.ok(sectorRe[0].test('  health') && !sectorRe[0].test('healthcare'), 'sector matches whole value, any case');
    assert.deepEqual(q.$and[2], { tags: { $in: ['vip'] } }, 'tags lower-cased');
    const withUsers: any = audienceQuery(cleanAudience({ tags: ['a'], userIds: ['0123456789abcdef01234567', 'bad-id'] }));
    assert.deepEqual(withUsers.$or[1], { _id: { $in: ['0123456789abcdef01234567'] } }, 'invalid ids dropped');
    assert.equal(describeAudience(cleanAudience({ sectors: ['Health'], userIds: ['0123456789abcdef01234567'] })), 'sector: Health + 1 chosen user');
    assert.equal(describeAudience(cleanAudience({})), 'Nobody yet');
  });

  await test('Audience: regex characters in a sector are matched literally', () => {
    const q: any = audienceQuery(cleanAudience({ sectors: ['F&B (food)'] }));
    const re: RegExp = q['companyInfo.sector'].$in[0];
    assert.ok(re.test('f&b (food)') && !re.test('F&B food'));
  });

  await test('Tools: list_inbox and inbox_action', async () => {
    const { TOOLS } = await import('../mcp/tools');
    const calls: any[] = [];
    const api = {
      request: async (method: string, path: string, opts: any = {}) => {
        calls.push({ method, path, ...opts });
        if (path === '/api/inbox/summary') return { action: 2, updates: 1, messages: 0 };
        if (path === '/api/inbox/items') {
          return opts.query.box === 'action'
            ? { items: [{ id: 'i1', box: 'action', title: 'Post failed', body: 'x', read: false, fromName: 'Blueprint', actions: [{ id: 'retry', label: 'Try again' }, { id: 'open', label: 'Open', link: '/p' }] }] }
            : { items: [{ id: 'i2', box: 'update', title: 'Read one', read: true, actions: [] }, { id: 'i3', box: 'update', title: 'New one', read: false, actions: [] }] };
        }
        return { message: 'Trying again now' };
      }
    };
    const ctx: any = { api, user: { id: 'u', email: 'e', name: 'n', role: 'hybrid', accessMode: 'part_two', canUseAI: false, canUseLibrary: true }, appUrl: 'https://app' };
    const list = TOOLS.find((t) => t.name === 'list_inbox')!;
    const out: any = await list.handler({}, ctx);
    assert.deepEqual(out.counts, { needs_action: 2, unread_updates: 1, unread_messages: 0 });
    assert.deepEqual(out.items.map((i: any) => i.id), ['i1', 'i3'], 'read updates are left out');
    assert.deepEqual(out.items[0].actions, [{ id: 'retry', label: 'Try again' }], 'link-only actions hidden');
    assert.equal(out.items[0].open_in_app, 'https://app/inbox?box=action&item=i1');
    const act = TOOLS.find((t) => t.name === 'inbox_action')!;
    assert.equal(act.annotations.destructiveHint, true, 'assistants confirm first');
    const r: any = await act.handler({ item_id: '0123456789abcdef01234567', action: 'retry' }, ctx);
    assert.equal(r.message, 'Trying again now');
    assert.equal(calls[calls.length - 1].path, '/api/inbox/items/0123456789abcdef01234567/actions/retry');
  });

  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`Inbox self-test: all ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
