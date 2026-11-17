/**
 * Posts self-test: status names (new and older), what publishing records mean for a post's status,
 * and the app links. Needs no database or network.   npm run posts:selftest
 */
import assert from 'assert/strict';
import {
  TaskStatus,
  normalizePostStatus,
  statusFromPublishing,
  USER_SETTABLE_STATUSES,
  ACCEPTED_STATUS_VALUES
} from '../lib/postStatus';
import { links, absolute } from '../lib/links';

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

async function main() {
  await test('new status names are read in any spelling', () => {
    assert.equal(normalizePostStatus('Idea'), TaskStatus.IDEA);
    assert.equal(normalizePostStatus('draft'), TaskStatus.DRAFT);
    assert.equal(normalizePostStatus(' READY '), TaskStatus.READY);
    assert.equal(normalizePostStatus('needs_attention'), TaskStatus.NEEDS_ATTENTION);
    assert.equal(normalizePostStatus('Needs-Attention'), TaskStatus.NEEDS_ATTENTION);
    assert.equal(normalizePostStatus('published'), TaskStatus.PUBLISHED);
    assert.equal(normalizePostStatus('Scheduled'), TaskStatus.SCHEDULED);
  });

  await test('older names are translated', () => {
    assert.equal(normalizePostStatus('Pending'), TaskStatus.DRAFT);
    assert.equal(normalizePostStatus('In Progress'), TaskStatus.DRAFT);
    assert.equal(normalizePostStatus('in-progress'), TaskStatus.DRAFT);
    assert.equal(normalizePostStatus('inprogress'), TaskStatus.DRAFT);
    assert.equal(normalizePostStatus('Completed'), TaskStatus.READY);
  });

  await test('words the AI tends to use', () => {
    assert.equal(normalizePostStatus('todo'), TaskStatus.IDEA);
    assert.equal(normalizePostStatus('posted'), TaskStatus.PUBLISHED);
    assert.equal(normalizePostStatus('failed'), TaskStatus.NEEDS_ATTENTION);
  });

  await test('non-statuses are rejected', () => {
    for (const v of [undefined, null, '', '  ', 'banana', 42, {}, ['Draft']]) assert.equal(normalizePostStatus(v), null);
  });

  await test('accepted input values include new and older names', () => {
    for (const s of Object.values(TaskStatus)) assert.ok(ACCEPTED_STATUS_VALUES.includes(s));
    for (const s of ['Pending', 'In Progress', 'Completed']) assert.ok(ACCEPTED_STATUS_VALUES.includes(s));
  });

  await test('people can set Idea, Draft, Ready, Published only', () => {
    assert.deepEqual(USER_SETTABLE_STATUSES, [TaskStatus.IDEA, TaskStatus.DRAFT, TaskStatus.READY, TaskStatus.PUBLISHED]);
  });

  await test('publishing records decide Scheduled / Published / Needs attention', () => {
    assert.equal(statusFromPublishing([]), null);
    assert.equal(statusFromPublishing(['draft']), null);
    assert.equal(statusFromPublishing(['cancelled', 'cancelled']), null);
    assert.equal(statusFromPublishing(['scheduled']), TaskStatus.SCHEDULED);
    assert.equal(statusFromPublishing(['publishing']), TaskStatus.SCHEDULED);
    assert.equal(statusFromPublishing(['processing']), TaskStatus.SCHEDULED);
    assert.equal(statusFromPublishing(['published']), TaskStatus.PUBLISHED);
    assert.equal(statusFromPublishing(['published', 'cancelled']), TaskStatus.PUBLISHED);
    // Still going out somewhere: not finished yet.
    assert.equal(statusFromPublishing(['published', 'scheduled']), TaskStatus.SCHEDULED);
    // Any problem wins: the person has to act.
    assert.equal(statusFromPublishing(['published', 'failed']), TaskStatus.NEEDS_ATTENTION);
    assert.equal(statusFromPublishing(['scheduled', 'due']), TaskStatus.NEEDS_ATTENTION);
    assert.equal(statusFromPublishing(['due']), TaskStatus.NEEDS_ATTENTION);
  });

  await test('app links: posts, themes and pages', () => {
    assert.equal(links.post('abc'), '/posts/abc');
    assert.equal(links.post({ _id: 'abc', name: 'x' }), '/posts/abc');
    assert.equal(links.theme('c1', 'p1'), '/campaigns/c1?theme=p1');
    assert.equal(links.theme({ _id: 'c1' }, { _id: 'p1' }), '/campaigns/c1?theme=p1');
    assert.equal(links.planner(), '/planner');
    assert.equal(links.planner({ view: 'list', campaign: 'c1' }), '/planner?view=list&campaign=c1');
    assert.equal(links.publishing('accounts'), '/publishing?tab=accounts');
    assert.equal(links.publishing(), '/publishing');
    assert.equal(links.inbox({ box: 'action', item: 'i1' }), '/inbox?box=action&item=i1');
    assert.equal(links.library({ view: 'review' }), '/library?view=review');
    assert.equal(links.settings('brand'), '/settings/brand');
    assert.equal(links.blue('chat1'), '/blue/chat1');
    assert.equal(absolute('http://localhost:3000/', '/posts/1'), 'http://localhost:3000/posts/1');
    assert.equal(absolute('https://app.example.com', 'posts/1'), 'https://app.example.com/posts/1');
  });

  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`Posts self-test: all ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
