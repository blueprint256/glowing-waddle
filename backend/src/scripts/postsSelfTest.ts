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
import { applyPlaceholderAliases, checkPlaceholders, knownPlaceholderRegex, isKnownPlaceholder } from '../lib/placeholders';
import { normalizePlan, parsePlanReply, planDay, planWindow, validatePlan, PLAN_LIMITS } from '../lib/campaignPlan';

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

  await test('placeholders: new names stand for the older ones', () => {
    assert.equal(applyPlaceholderAliases('{brand} {brandName} {campaign} {postTitle} {brief} {caption} {image}'),
      '{companyInfo} {companyName} {campaignDetails} {taskName} {taskDescription} {taskContent} {baseImage}');
    assert.equal(applyPlaceholderAliases('{referenceImage2} {attachedImage3}'), '{attachedImage2} {attachedImage3}');
    // Older names, custom names and JSON are left alone.
    assert.equal(applyPlaceholderAliases('{taskDescription} {tone} {"a": 1}'), '{taskDescription} {tone} {"a": 1}');
  });

  await test('placeholders: unknown names are found, with the likely intended one', () => {
    const r = checkPlaceholders('Hi {brandName}, {companyNmae} {captoin} {brief} {"json": true} {zzqqxx}');
    assert.deepEqual(r.used.sort(), ['brandName', 'brief']);
    const byName = Object.fromEntries(r.unknown.map((u) => [u.name, u.suggestion]));
    assert.equal(byName.companyNmae, 'brandName');
    assert.equal(byName.captoin, 'caption');
    assert.equal(byName.zzqqxx, undefined);
    assert.ok(!('json' in byName));
  });

  await test('placeholders: every name is cleared when it has no data', () => {
    const re = knownPlaceholderRegex();
    assert.equal('a{brief}b{taskDescription}c{referenceImage4}d{attachedImage12}e{custom}'.replace(re, ''), 'abcde{custom}');
    assert.ok(isKnownPlaceholder('attachedImage7') && isKnownPlaceholder('referenceImage7') && !isKnownPlaceholder('tone'));
  });

  await test('plan with AI: days, period and replies are read safely', () => {
    assert.equal(planDay('2026-11-20'), '2026-11-20');
    assert.equal(planDay('2026-11-20T09:00:00Z'), '2026-11-20');
    assert.equal(planDay('TBD'), null);
    assert.equal(planDay(undefined), null);
    const now = new Date('2026-11-17T10:00:00Z');
    assert.deepEqual(planWindow({ startDate: new Date('2026-12-01'), endDate: new Date('2026-12-31') } as any, {}, now), { from: '2026-12-01', to: '2026-12-31' });
    // A campaign that started in the past is planned from today; no end date → 4 weeks.
    assert.deepEqual(planWindow({ startDate: new Date('2026-10-01') } as any, {}, now), { from: '2026-11-17', to: '2026-12-14' });
    assert.deepEqual(planWindow({} as any, { from: '2026-11-20', to: '2026-11-10' }, now), { from: '2026-11-20', to: '2026-12-17' });
    assert.equal(parsePlanReply('Here you go:\n```json\n[{"projectName":"A"}]\n```').length, 1);
    assert.equal(parsePlanReply('{"projects":[{"projectName":"A"},{"projectName":"B"}]}').length, 2);
    assert.equal(parsePlanReply('Sure! [{"projectName":"A"}] Hope it helps').length, 1);
    assert.throws(() => parsePlanReply('I cannot help with that'));
    assert.throws(() => parsePlanReply('[{"projectName": "A", "tasks": [{"taskName": "cut off'));
  });

  await test('plan with AI: drafts are cleaned and limited', () => {
    const themes = normalizePlan([
      { projectName: ' Launch ', projectDescription: 'Big week', tasks: [
        { taskName: 'Teaser', taskDescription: 'Brief', content: 'Caption', taskDate: '2026-11-20', status: 'Completed' },
        { taskName: '', content: 'no title is skipped' },
        { title: 'Other names work', caption: 'c', date: 'soon', status: 'Idea' }
      ] },
      { name: '' },
      'junk'
    ]);
    assert.equal(themes.length, 1);
    assert.equal(themes[0].name, 'Launch');
    assert.deepEqual(themes[0].posts.map((p) => [p.name, p.day, p.status]), [['Teaser', '2026-11-20', 'Ready'], ['Other names work', null, 'Idea']]);
    const many = normalizePlan([{ projectName: 'X', tasks: Array.from({ length: 100 }, (_, i) => ({ taskName: `P${i}` })) }]);
    assert.equal(many[0].posts.length, PLAN_LIMITS.postsPerTheme);
    // What the app sends back after review keeps the chosen existing theme (and only valid ids).
    const back = validatePlan([
      { name: 'Existing', existingId: '64b7f0c2a1b2c3d4e5f60718', posts: [{ name: 'One', day: '2026-11-21', status: 'Draft' }] },
      { name: 'Bad id', existingId: 'nope', posts: [{ name: 'Two' }] }
    ]);
    assert.equal(back[0].existingId, '64b7f0c2a1b2c3d4e5f60718');
    assert.equal(back[1].existingId, null);
    assert.throws(() => validatePlan([{ name: 'Empty', posts: [] }]));
    assert.throws(() => validatePlan('nope'));
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
