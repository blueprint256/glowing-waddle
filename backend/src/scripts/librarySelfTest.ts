/**
 * Self-test for the Library (Aggregator) building blocks — no database, no network:
 * zip reading, Word/PowerPoint/HTML text extraction, date detection (EXIF, file names), image
 * thumbnails and similarity hashes, AI analysis parsing, search ranking, the overview tree and the
 * vision/embedding request formats.
 *
 *   npm run library:selftest
 */
import assert from 'assert/strict';
import zlib from 'zlib';
import sharp from 'sharp';
import { listZip, readZipEntry, importableEntries, ZipError } from '../library/zip';
import { extractText, htmlToText } from '../library/text';
import { dateFromFilename, chooseCapturedAt, parseDay, parseExifDateString } from '../library/dates';
import { exifCaptureDate } from '../library/exif';
import { inspectImage, differenceHash, hammingDistance, sha256 } from '../library/media';
import { resolveMime, kindOf, titleFromFilename, folderOf, isZip } from '../library/files';
import { buildAnalysisPrompt, parseAnalysis } from '../library/analysis';
import { cosine, reciprocalRankFusion, buildSearchText, embeddingText } from '../library/search';
import { buildOverview } from '../library/overview';
import { buildVisionBody, runVision, embedTexts } from '../library/vision';
import type { FetchLike } from '../blue/providers';

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (error: any) {
    failures.push(`✗ ${name}\n    ${error?.stack?.split('\n').slice(0, 3).join('\n    ') || error}`);
  }
}

// --- tiny zip writer for fixtures -------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(f.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(f.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

async function poster(color: string, text = 'SALE'): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="${color}"/><circle cx="400" cy="380" r="220" fill="#ffffff"/><rect x="120" y="700" width="560" height="140" fill="#222222"/><text x="400" y="800" font-size="90" text-anchor="middle" fill="#ffffff">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  await test('zip: list, read stored + deflated, skip junk, reject garbage', () => {
    const zip = makeZip([
      { name: 'Clients/Acme/2024/poster.txt', data: Buffer.from('hello'), deflate: true },
      { name: 'notes.md', data: Buffer.from('# Caption\nBig sale') },
      { name: '__MACOSX/._poster.txt', data: Buffer.from('x') },
      { name: 'Clients/.DS_Store', data: Buffer.from('x') },
      { name: 'Clients/', data: Buffer.alloc(0) }
    ]);
    const entries = listZip(zip);
    assert.equal(entries.length, 5);
    const usable = importableEntries(entries);
    assert.deepEqual(usable.map((e) => e.name), ['Clients/Acme/2024/poster.txt', 'notes.md']);
    assert.equal(readZipEntry(zip, usable[0], 1000).toString(), 'hello');
    assert.equal(readZipEntry(zip, usable[1], 1000).toString(), '# Caption\nBig sale');
    assert.throws(() => readZipEntry(zip, usable[0], 2), ZipError);
    assert.throws(() => listZip(Buffer.from('not a zip at all, definitely not')), ZipError);
  });

  await test('text: docx, pptx, html, plain', () => {
    const docx = makeZip([
      { name: 'word/document.xml', deflate: true, data: Buffer.from('<w:document><w:body><w:p><w:r><w:t>Women&apos;s Day caption</w:t></w:r></w:p><w:p><w:r><w:t>Celebrate her &amp; you</w:t></w:r></w:p></w:body></w:document>') }
    ]);
    assert.equal(extractText(docx, 'caption.docx', 'application/octet-stream'), "Women's Day caption\nCelebrate her & you");
    const pptx = makeZip([
      { name: 'ppt/slides/slide2.xml', data: Buffer.from('<p:sld><a:t>Second</a:t></p:sld>') },
      { name: 'ppt/slides/slide1.xml', data: Buffer.from('<p:sld><a:t>Launch</a:t><a:t>plan</a:t></p:sld>') }
    ]);
    assert.equal(extractText(pptx, 'deck.pptx', ''), 'Slide 1: Launch plan\nSlide 2: Second');
    assert.equal(htmlToText('<p>Hi&nbsp;there</p><script>x()</script><div>Bye</div>'), 'Hi there\nBye');
    assert.equal(extractText(Buffer.from('﻿hashtags #sale'), 'notes.txt', 'text/plain'), 'hashtags #sale');
    assert.equal(extractText(Buffer.from([0, 1, 2]), 'photo.jpg', 'image/jpeg'), '');
  });

  await test('dates: file names, AI dates, EXIF strings and precedence', () => {
    const iso = (d: Date | null) => d?.toISOString().slice(0, 10);
    assert.equal(iso(dateFromFilename('IMG_20240308_101500.jpg')), '2024-03-08');
    assert.equal(iso(dateFromFilename('WhatsApp Image 2024-03-08 at 10.15.00.jpeg')), '2024-03-08');
    assert.equal(iso(dateFromFilename('Screenshot 2023-12-31 182000.png')), '2023-12-31');
    assert.equal(iso(dateFromFilename('poster_2024_02_30.png')), undefined); // invalid day
    assert.equal(dateFromFilename('final-v12345678.png'), null);
    assert.equal(dateFromFilename('order 1234567.png'), null);
    assert.equal(iso(parseDay('2024-03-08')), '2024-03-08');
    assert.equal(parseDay('March 8'), null);
    assert.equal(parseExifDateString('2024:03:08 10:15:00')?.toISOString(), '2024-03-08T10:15:00.000Z');
    const up = new Date('2026-11-16T10:00:00Z');
    assert.equal(chooseCapturedAt({ exif: new Date('2020-01-01'), filename: new Date('2021-01-01'), uploadedAt: up }).source, 'exif');
    assert.equal(chooseCapturedAt({ filename: new Date('2021-01-01'), content: new Date('2022-01-01'), uploadedAt: up }).source, 'filename');
    assert.equal(chooseCapturedAt({ content: new Date('2022-01-01'), fileModified: new Date('2021-01-01'), uploadedAt: up }).source, 'content');
    assert.equal(chooseCapturedAt({ fileModified: new Date('2025-05-01'), uploadedAt: up }).source, 'file_modified');
    assert.equal(chooseCapturedAt({ fileModified: new Date('2026-11-16T09:00:00Z'), uploadedAt: up }).source, 'upload');
  });

  await test('files: MIME fallback, kinds, titles, folders', () => {
    assert.equal(resolveMime('a.JPG', 'application/octet-stream'), 'image/jpeg');
    assert.equal(resolveMime('a.png', 'image/png'), 'image/png');
    assert.equal(kindOf('x.psd', 'image/vnd.adobe.photoshop'), 'design');
    assert.equal(kindOf('x.docx', resolveMime('x.docx')), 'document');
    assert.equal(kindOf('x.mov', resolveMime('x.mov')), 'video');
    assert.equal(kindOf('x.csv', resolveMime('x.csv')), 'text');
    assert.equal(titleFromFilename("Clients/IMG_2041 women's-day_final.png"), "IMG 2041 women's day final");
    assert.equal(folderOf('Clients/Acme/2024/poster.png'), 'Clients/Acme/2024');
    assert.equal(isZip('backup.ZIP', ''), true);
  });

  await test('images: thumbnail, AI image, size, EXIF capture date', async () => {
    const png = await poster('#e11d48');
    const withExif = await sharp(png)
      .jpeg()
      .withExif({ IFD0: { Make: 'Test' }, IFD2: { DateTimeOriginal: '2024:03:08 10:15:00' } } as any)
      .toBuffer();
    const info = await inspectImage(withExif);
    assert.ok(info);
    assert.equal(info!.width, 800);
    assert.equal(info!.height, 1000);
    assert.equal(info!.exifDate?.toISOString(), '2024-03-08T10:15:00.000Z');
    const thumbMeta = await sharp(info!.thumbnail).metadata();
    assert.equal(thumbMeta.format, 'webp');
    assert.ok(thumbMeta.width! <= 512 && thumbMeta.height! <= 512);
    const aiMeta = await sharp(info!.aiImage).metadata();
    assert.equal(aiMeta.format, 'jpeg');
    assert.ok(Math.max(aiMeta.width!, aiMeta.height!) <= 1024);
    assert.equal(exifCaptureDate(undefined), null);
    assert.equal(await inspectImage(Buffer.from('not an image')), null);
  });

  await test('images: similarity hash finds edited versions, not different images', async () => {
    const v1 = await poster('#e11d48', 'SALE');
    const v2 = await sharp(await poster('#e11d48', 'SALE!')).modulate({ brightness: 1.08 }).resize(640).png().toBuffer(); // small edit + resize
    const other = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#0ea5e9"/><rect x="0" y="0" width="400" height="600" fill="#111827"/><circle cx="600" cy="150" r="90" fill="#fde047"/></svg>')).png().toBuffer();
    const [h1, h2, h3] = await Promise.all([differenceHash(v1), differenceHash(v2), differenceHash(other)]);
    assert.equal(h1.length, 16);
    assert.ok(hammingDistance(h1, h2) <= 10, `edit distance ${hammingDistance(h1, h2)}`);
    assert.ok(hammingDistance(h1, h3) > 20, `different distance ${hammingDistance(h1, h3)}`);
    assert.equal(hammingDistance(h1, h1), 0);
    assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  await test('analysis: prompt and tolerant JSON parsing', () => {
    const prompt = buildAnalysisPrompt({ fileName: 'wd.png', folder: '2024/March', kind: 'image', mime: 'image/png', knownDate: '2024-03-08', companyName: 'Kawa Bora', hasImage: true, extractedText: 'x' });
    assert.match(prompt, /Kawa Bora/);
    assert.match(prompt, /Folder: 2024\/March/);
    assert.match(prompt, /ONLY a JSON object/);
    const parsed = parseAnalysis('Here you go:\n```json\n{"title":"Women\'s Day poster","category":"poster","description":"A pink poster.","text_in_image":"HAPPY WOMEN\'S DAY","tags":["Women","women","celebration"],"event":"Women\'s Day","content_date":"2024-03-08","colors":["Pink"],"language":"English"}\n```');
    assert.ok(parsed);
    assert.equal(parsed!.category, 'poster');
    assert.deepEqual(parsed!.tags, ['women', 'celebration']);
    assert.equal(parsed!.contentDate?.toISOString().slice(0, 10), '2024-03-08');
    assert.deepEqual(parsed!.colors, ['pink']);
    assert.equal(parseAnalysis('{"category":"spaceship","content_date":"soon"}')!.category, 'other');
    assert.equal(parseAnalysis('{"content_date":"soon"}')!.contentDate, null);
    assert.equal(parseAnalysis('no json here'), null);
  });

  await test('search: cosine, rank fusion, search text', () => {
    assert.equal(Math.round(cosine([1, 0], [1, 0]) * 100), 100);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.equal(cosine([1], [1, 2]), 0);
    assert.deepEqual(reciprocalRankFusion([['a', 'b', 'c'], ['c', 'a']]), ['a', 'c', 'b']);
    const text = buildSearchText({ title: 'Poster', event: "Women's Day", tags: ['pink'], folder: 'Clients/Acme', category: 'social_post' });
    assert.match(text, /Women's Day/);
    assert.match(text, /Clients Acme/);
    assert.match(text, /social post/);
    assert.ok(embeddingText({ title: 'T', textContent: 'x'.repeat(5000) }).length < 2000);
  });

  await test('overview: years → months → events, sorted newest first', () => {
    const o = buildOverview([
      { year: 2024, month: 3, count: 12, kinds: { image: 10, document: 2 }, events: { "Women's Day": 9, Easter: 1 } },
      { year: 2024, month: 11, count: 30, kinds: { image: 30 }, events: { 'Black Friday': 25 } },
      { year: 2025, month: 1, count: 4, kinds: { video: 4 }, events: {} }
    ]);
    assert.equal(o.total, 46);
    assert.deepEqual(o.kinds, { image: 40, document: 2, video: 4 });
    assert.deepEqual(o.years.map((y) => y.year), [2025, 2024]);
    assert.deepEqual(o.years[1].months.map((m) => m.name), ['November', 'March']);
    assert.deepEqual(o.years[1].months[1].events[0], { name: "Women's Day", count: 9 });
    assert.equal(o.topEvents[0].name, 'Black Friday');
  });

  await test('vision + embeddings: request shapes and parsing', async () => {
    const a = buildVisionBody({ provider: 'anthropic', apiKey: 'k', model: 'm', prompt: 'P', image: { mediaType: 'image/jpeg', base64: 'AAA' }, pdfBase64: 'PDF' });
    assert.equal(a.url, 'https://api.anthropic.com/v1/messages');
    assert.deepEqual(a.body.messages[0].content.map((c: any) => c.type), ['image', 'document', 'text']);
    const o = buildVisionBody({ provider: 'openai', apiKey: 'k', model: 'm', prompt: 'P', image: { mediaType: 'image/jpeg', base64: 'AAA' } });
    assert.equal(o.body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAA');
    assert.equal(buildVisionBody({ provider: 'grok', apiKey: 'k', model: 'm', prompt: 'P' }).url, 'https://api.x.ai/v1/chat/completions');

    const fake: FetchLike = async (url, init) => {
      const body = JSON.parse(init.body);
      const json = url.includes('embeddings')
        ? { data: body.input.map((_: string, i: number) => ({ index: i, embedding: [i, 1] })).reverse() }
        : url.includes('anthropic')
          ? { content: [{ type: 'text', text: '{"title":"x"}' }], usage: { input_tokens: 900, output_tokens: 80 } }
          : { choices: [{ message: { content: '{"title":"y"}' } }], usage: { prompt_tokens: 5, completion_tokens: 6 } };
      return { ok: true, status: 200, text: async () => JSON.stringify(json) };
    };
    const r1 = await runVision({ provider: 'anthropic', apiKey: 'k', model: 'm', prompt: 'P', fetchImpl: fake });
    assert.deepEqual(r1, { text: '{"title":"x"}', usage: { input: 900, output: 80 } });
    const r2 = await runVision({ provider: 'openai', apiKey: 'k', model: 'm', prompt: 'P', fetchImpl: fake });
    assert.equal(r2.text, '{"title":"y"}');
    assert.deepEqual(await embedTexts('k', ['a', 'b'], fake), [[0, 1], [1, 1]]);
  });

  await test('Library tools: gated per user, search maps filters and shapes results for the AI', async () => {
    const { TOOLS } = await import('../mcp/tools');
    const names = ['library_overview', 'search_library', 'get_library_item', 'update_library_item', 'restore_library_version', 'delete_library_item'];
    const user = { id: 'u1', email: 'a@b.c', name: 'Ada', role: 'hybrid', accessMode: 'part_two', canUseAI: false, canUseLibrary: true };
    const calls: any[] = [];
    const api = {
      request: async (method: string, path: string, opts: any = {}) => {
        calls.push({ method, path, ...opts });
        if (path === '/api/library/items' && method === 'GET') {
          return {
            items: [
              {
                id: 'a1', title: "Women's Day poster", kind: 'image', category: 'poster', capturedAt: '2024-03-08T00:00:00.000Z',
                dateSource: 'exif', event: "Women's Day", tags: ['pink'], textPreview: 'CELEBRATE HER', versionCount: 3,
                currentVersion: { number: 3, originalName: 'wd-final.png', mime: 'image/png', size: 204800, width: 1080, height: 1350 },
                links: { campaignId: null, projectId: null, taskId: 't1' }, aiStatus: 'done', needsReview: false, deletedAt: null,
                thumbnailUrl: '/api/library/items/a1/file?variant=thumb'
              }
            ],
            total: 1, page: 1, limit: 12
          };
        }
        if (method === 'GET' && path === '/api/library/items/a1') {
          return { item: { id: 'a1', title: 'x', versions: [{ id: 'v1', number: 1 }, { id: 'v2', number: 2 }] } };
        }
        return { item: { id: 'a1', title: 'x', links: {} }, message: 'ok' };
      }
    };
    const ctxOn: any = { api, user, appUrl: 'https://app.example' };
    const ctxOff: any = { api, user: { ...user, canUseLibrary: false }, appUrl: 'https://app.example' };
    for (const n of names) {
      const tool = TOOLS.find((x) => x.name === n);
      assert.ok(tool, `${n} exists`);
      assert.equal(tool!.isAvailable ? tool!.isAvailable(ctxOn) : true, true);
      assert.equal(tool!.isAvailable ? tool!.isAvailable(ctxOff) : true, false, `${n} hidden when Library is off`);
    }
    const search = TOOLS.find((x) => x.name === 'search_library')!;
    const out: any = await search.handler({ query: 'pink poster', date_from: '2024-02-15', date_to: '2024-03-31', kind: 'image' }, ctxOn);
    assert.deepEqual(calls[0].query, { q: 'pink poster', kind: 'image', category: undefined, event: undefined, tags: undefined, from: '2024-02-15', to: '2024-03-31', campaignId: undefined, taskId: undefined, needsReview: undefined, trash: undefined, sort: undefined, page: 1, limit: 12 });
    assert.equal(out.items[0].date, '2024-03-08');
    assert.equal(out.items[0].url, 'https://app.example/library/a1');
    assert.equal(out.items[0].current_version, 3);
    assert.equal(out.items[0].linked_task_id, 't1');
    assert.equal(out.items[0].file.size_kb, 200);
    assert.equal(out.items[0].ai_status, undefined, 'done is not repeated');

    calls.length = 0;
    const restore = TOOLS.find((x) => x.name === 'restore_library_version')!;
    await restore.handler({ item_id: 'a1', version_number: 1 }, ctxOn);
    assert.equal(calls[1].path, '/api/library/items/a1/versions/v1/restore');
    await assert.rejects(() => restore.handler({ item_id: 'a1', version_number: 9 }, ctxOn), /versions 1, 2/);

    calls.length = 0;
    const update = TOOLS.find((x) => x.name === 'update_library_item')!;
    await update.handler({ item_id: 'a1', date: '2023-03-08', link_task_id: null }, ctxOn);
    assert.deepEqual(calls[0].body, { capturedAt: '2023-03-08', links: {} });
  });

  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`Library self-test: all ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
