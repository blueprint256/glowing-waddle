/**
 * Posts self-test: status names (new and older), what publishing records mean for a post's status,
 * the app links, automatic titles, the picture rules (sizes, logo, AI words), Plan with AI and the
 * AI allowance. Needs no database or network.   npm run posts:selftest
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
import { effectiveLimit, limitMessage, monthWindow, remainingOf } from '../lib/aiAllowance';
import { normalizePlan, parsePlanReply, pictureLines, planDay, planWindow, validatePlan, PLAN_LIMITS } from '../lib/campaignPlan';
import { titleFrom } from '../lib/postTitle';
import sharp from 'sharp';
import { composePicture } from '../lib/pictureCompose';
import {
  BUILTIN_CHANGE_IMAGE,
  BUILTIN_CREATE_IMAGE,
  FORMAT_SIZES,
  apiSizeFor,
  brandText,
  campaignText,
  changeLogoNote,
  cleanInstruction,
  fillTemplate,
  formatOf,
  isCorner,
  isFormat,
  isRole,
  logoBox,
  logoNote,
  referenceNotes
} from '../lib/postPicture';

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

  await test('app links: posts, campaigns and pages', () => {
    assert.equal(links.post('abc'), '/posts/abc');
    assert.equal(links.post({ _id: 'abc', name: 'x' }), '/posts/abc');
    assert.equal(links.campaign({ _id: 'c1' }), '/campaigns/c1');
    assert.equal(links.planner(), '/planner');
    assert.equal(links.planner({ view: 'list', campaign: 'c1' }), '/planner?view=list&campaign=c1');
    assert.equal(links.planner({ campaign: 'none' }), '/planner?campaign=none');
    assert.ok(!('theme' in links), 'themes are retired');
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

  await test('plan with AI: each post’s picture facts go into its brief for the poster', () => {
    const [p] = normalizePlan([
      {
        title: 'Clean-up day',
        brief: 'Invite members to the beach clean-up.',
        caption: 'Join us!',
        day: '2026-12-05',
        picture: { kind: 'poster', facts: { headline: 'Clean beaches, together', date: 'Saturday 5 December', time: '8:00 am', place: 'Ggaba landing site', figures: ['300 kg collected last year', '', 7] } }
      }
    ]);
    assert.match(p.brief, /^Invite members to the beach clean-up\.\n\nPoster facts:\n- Headline idea: Clean beaches, together\n- Date: Saturday 5 December\n- Time: 8:00 am\n- Place: Ggaba landing site\n- Figures: 300 kg collected last year; 7$/);
    assert.equal(pictureLines({ kind: 'photo', facts: { headline: 'x' } }), 'Picture: a photo with no words.');
    assert.equal(pictureLines({ kind: 'poster' }), 'Poster facts:');
    assert.equal(pictureLines(null), '');
    assert.equal(pictureLines('poster'), '');
    // A plan without pictures (older prompts) keeps its brief as it is.
    assert.equal(normalizePlan([{ title: 'A', brief: 'Just this' }])[0].brief, 'Just this');
    // Facts already in the brief aren't added twice (the plan is reviewed and sent back).
    const again = normalizePlan([{ title: 'B', brief: p.brief, picture: { kind: 'poster', facts: { headline: 'Clean beaches, together', date: 'Saturday 5 December', time: '8:00 am', place: 'Ggaba landing site', figures: ['300 kg collected last year', '', 7] } } }]);
    assert.equal(again[0].brief, p.brief);
  });

  await test('plan with AI: posts are cleaned, sorted by day and limited', () => {
    const posts = normalizePlan([
      { title: ' Teaser ', brief: 'Brief', caption: 'Caption', day: '2026-11-22', status: 'Completed' },
      { title: '', caption: '', brief: '' },
      { caption: 'Only a caption works (the title comes from it)', day: '2026-11-20' },
      { name: 'Other names work', content: 'c', date: 'soon', status: 'Idea' },
      'junk'
    ]);
    assert.deepEqual(posts.map((p) => [p.name, p.day, p.status]), [
      ['', '2026-11-20', 'Draft'],
      ['Teaser', '2026-11-22', 'Ready'],
      ['Other names work', null, 'Idea']
    ]);
    // Older prompts answer in themes: the groups are flattened.
    const flat = normalizePlan([
      { projectName: 'Launch', tasks: [{ taskName: 'A', taskDate: '2026-11-21' }, { taskName: 'B', taskDate: '2026-11-19' }] },
      { projectName: 'Tips', posts: [{ title: 'C' }] }
    ]);
    assert.deepEqual(flat.map((p) => p.name), ['B', 'A', 'C']);
    const many = normalizePlan(Array.from({ length: 300 }, (_, i) => ({ title: `P${i}` })));
    assert.equal(many.length, PLAN_LIMITS.posts);
    // What the app sends back after review: { posts }, or the older { themes }.
    assert.equal(validatePlan({ posts: [{ name: 'One', day: '2026-11-21', status: 'Draft' }] })[0].name, 'One');
    assert.equal(validatePlan({ themes: [{ name: 'Old', posts: [{ name: 'Two' }] }] })[0].name, 'Two');
    assert.throws(() => validatePlan({ posts: [] }));
    assert.throws(() => validatePlan({} as any));
    assert.equal(parsePlanReply('{"posts":[{"title":"A"},{"title":"B"}]}').length, 2);
  });

  await test('automatic titles come from the caption, then the brief', () => {
    assert.equal(titleFrom('🎉 Big news! Our cold brew is back this Friday at all shops #coffee'), 'Big news! Our cold brew is back');
    assert.equal(titleFrom('#ad #summer\nFresh lemonade, all summer long'), 'Fresh lemonade, all summer long');
    assert.equal(titleFrom('', '  ', 'Launch of the winter menu'), 'Launch of the winter menu');
    assert.equal(titleFrom('Check https://example.com/x now'), 'Check now');
    assert.equal(titleFrom('', null, undefined), 'Untitled post');
    assert.equal(titleFrom('😀🎉 #only #tags'), 'Untitled post');
    assert.ok(titleFrom('Supercalifragilisticexpialidocious '.repeat(4)).length <= 60);
    assert.equal(titleFrom('Hello there, —'), 'Hello there');
  });

  await test('pictures: sizes, shapes and choices', () => {
    assert.deepEqual([FORMAT_SIZES.square.api, FORMAT_SIZES.portrait.api, FORMAT_SIZES.landscape.api], ['1024x1024', '1024x1536', '1536x1024']);
    assert.equal(FORMAT_SIZES.portrait.width / FORMAT_SIZES.portrait.height, 0.8); // Instagram's tallest feed shape (4:5)
    assert.equal(apiSizeFor(1080, 1350), '1024x1536');
    assert.equal(apiSizeFor(1080, 1080), '1024x1024');
    assert.equal(apiSizeFor(1920, 1080), '1536x1024');
    assert.equal(apiSizeFor(0, 0), '1024x1024');
    assert.equal(formatOf(1024, 1280), 'portrait');
    assert.ok(isFormat('square') && !isFormat('banner'));
    assert.ok(isCorner('bottom-right') && !isCorner('middle') && !isCorner(null));
    assert.ok(isRole('style') && isRole('include') && !isRole('logo'));
    assert.equal(cleanInstruction('  make   it\n bluer '), 'make it bluer');
    assert.equal(cleanInstruction(42), '');
  });

  await test('pictures: the logo fits its corner and stays inside', () => {
    // A wide logo is limited by width (18%), a tall one by height (12%); 4% margin.
    const wide = logoBox(1000, 1000, 400, 100, 'bottom-right');
    assert.deepEqual(wide, { left: 1000 - 180 - 40, top: 1000 - 45 - 40, width: 180, height: 45 });
    const tall = logoBox(1000, 1000, 100, 400, 'top-left');
    assert.deepEqual(tall, { left: 40, top: 40, width: 30, height: 120 });
    const portrait = logoBox(1024, 1280, 512, 512, 'top-right');
    assert.equal(portrait.left + portrait.width + Math.round(1024 * 0.04), 1024);
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const b = logoBox(1536, 1024, 3000, 1000, corner);
      assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.width <= 1536 && b.top + b.height <= 1024, corner);
    }
  });

  await test('pictures: the words sent to the AI', () => {
    const notes = referenceNotes([{ role: 'include', name: 'Cold brew bottle' }, { role: 'style' }]);
    assert.match(notes, /^Picture 1 \(“Cold brew bottle”\): INCLUDE THIS/);
    assert.match(notes, /Picture 2: STYLE ONLY/);
    assert.match(notes, /Do NOT copy its words, logos, brand names, people or products/);
    assert.equal(referenceNotes([]), '');
    assert.match(logoNote('top-left'), /top-left corner/);
    assert.match(logoNote(null), /Do not add any logo/);
    assert.equal(changeLogoNote(null), '');
    assert.match(changeLogoNote('bottom-right'), /bottom-right corner/);
    assert.equal(brandText(null), 'Not given.');
    assert.equal(brandText({ companyName: 'Bean There', brandTone: ' warm ' }), 'Name: Bean There\nTone: warm');
    assert.match(campaignText(null), /everyday content/);
    // Every placeholder of the built-in words is filled; unknown ones are left alone.
    const values = { brief: 'b', caption: 'c', brand: 'x', campaign: 'y', references: 'r', format: 'f', logoNote: 'l', instruction: 'i' };
    assert.ok(!/\{[a-zA-Z]+\}/.test(fillTemplate(BUILTIN_CREATE_IMAGE, values)));
    assert.ok(!/\{[a-zA-Z]+\}/.test(fillTemplate(BUILTIN_CHANGE_IMAGE, values)));
    assert.equal(fillTemplate('{a} {b} {"x": 1}', { a: '$1 & $&' }), '$1 & $& {b} {"x": 1}');
    assert.ok(isKnownPlaceholder('references') && isKnownPlaceholder('logoNote') && isKnownPlaceholder('format'));
  });

  await test('pictures: trimmed to shape, logo stamped exactly, saved as JPEG', async () => {
    // A 2:3 "AI picture": red top third, green middle, blue bottom third.
    const raw = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#00aa00' } })
      .composite([
        { input: { create: { width: 1024, height: 512, channels: 3, background: '#ff0000' } }, left: 0, top: 0 },
        { input: { create: { width: 1024, height: 512, channels: 3, background: '#0000ff' } }, left: 0, top: 1024 }
      ])
      .png()
      .toBuffer();
    const plain = await composePicture(raw, FORMAT_SIZES.portrait, null);
    const meta = await sharp(plain).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 1024, 1280]);
    assert.ok(plain.length < raw.length * 4, 'JPEG stays small');
    // Trimmed evenly from top and bottom: the centre is still green.
    const centre = await sharp(plain).extract({ left: 512, top: 640, width: 1, height: 1 }).raw().toBuffer();
    assert.ok(centre[1] > 150 && centre[0] < 60, 'centre kept');
    // An SVG logo (a black rectangle), bottom-right.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#000"/></svg>');
    const stamped = await composePicture(raw, FORMAT_SIZES.square, { buffer: svg, corner: 'bottom-right' });
    const box = logoBox(1024, 1024, 200, 100, 'bottom-right');
    const inLogo = await sharp(stamped).extract({ left: box.left + Math.floor(box.width / 2), top: box.top + Math.floor(box.height / 2), width: 1, height: 1 }).raw().toBuffer();
    assert.ok(inLogo[0] < 40 && inLogo[1] < 40 && inLogo[2] < 40, 'logo is where logoBox says');
    const outside = await sharp(stamped).extract({ left: 20, top: 1000, width: 1, height: 1 }).raw().toBuffer();
    assert.ok(outside[2] > 150, 'the rest is untouched');
  });

  await test('AI allowance: month window, limits and messages', () => {
    const w = monthWindow(new Date('2026-11-17T10:00:00Z'));
    assert.equal(w.start.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(w.resetsAt.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(monthWindow(new Date('2026-12-31T23:59:00Z')).resetsAt.toISOString(), '2027-01-01T00:00:00.000Z');
    assert.equal(effectiveLimit(null, 20, 99), 20); // account uses the workspace allowance
    assert.equal(effectiveLimit(5, 20, 99), 5); // its own
    assert.equal(effectiveLimit(0, 20, 99), 0); // 0 = no limit
    assert.equal(effectiveLimit(undefined, undefined, 99), 99);
    assert.equal(effectiveLimit(-3, 2.5, 99), 99); // nonsense falls back
    assert.equal(remainingOf(20, 7), 13);
    assert.equal(remainingOf(20, 25), 0);
    assert.equal(remainingOf(0, 25), null);
    assert.match(limitMessage('images', 20, w.resetsAt), /all 20 AI pictures \(posters and photos\) .* 1 December/);
    // Posters count against the same allowance as photos.
    assert.equal(limitMessage('designs', 20, w.resetsAt), limitMessage('images', 20, w.resetsAt));
    assert.match(limitMessage('blueMessages', 1, w.resetsAt), /all 1 Blue message for/);
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
