/**
 * Publishing self-test: platform rules, secrets, and the exact requests each platform plug-in sends,
 * using a fake network. Needs no database, storage or internet.
 *
 *   npm run publishing:selftest
 */
import assert from 'assert/strict';
import { validatePost, xLength, hasErrors } from '../publishing/rules';
import { encryptSecret, decryptSecret, pkcePair, maskSecret } from '../publishing/secrets';
import { escapeLittleText, linkedinVersion, linkedinAdapter } from '../publishing/platforms/linkedin';
import { tiktokChunks, tiktokAdapter } from '../publishing/platforms/tiktok';
import { xAdapter } from '../publishing/platforms/x';
import { metaAdapter } from '../publishing/platforms/meta';
import { youtubeAdapter } from '../publishing/platforms/youtube';
import { simulatePublish, ADAPTERS, PLATFORM_PROVIDER } from '../publishing/registry';
import { canvaDesignSize, correlationFromJwt } from '../canva/helpers';
import { PublishRequest, MediaFile, FetchLike, ProviderSettings, PLATFORMS } from '../publishing/types';

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

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function fakeFetch(route: (c: Call) => { status?: number; json?: any; headers?: Record<string, string>; text?: string }) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init: any = {}) => {
    const c: Call = { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    calls.push(c);
    const r = route(c);
    const status = r.status ?? 200;
    const hdrs = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => hdrs[n.toLowerCase()] ?? null }, text: async () => r.text ?? JSON.stringify(r.json ?? {}) };
  };
  return { fetchImpl, calls };
}

function file(kind: 'image' | 'video', size: number, mime = kind === 'image' ? 'image/png' : 'video/mp4'): MediaFile {
  const buf = Buffer.alloc(size, 7);
  return {
    kind,
    mime,
    size,
    name: kind === 'image' ? 'poster.png' : 'clip.mp4',
    read: async (s, e) => buf.subarray(s, e + 1),
    readAll: async () => buf,
    publicUrl: async () => `https://files.example/${kind}`,
    publicJpegUrl: async () => `https://files.example/${kind}.jpg`
  };
}

const settings: ProviderSettings = { enabled: true, clientId: 'cid', clientSecret: 'secret', options: {} };

function req(fetchImpl: FetchLike, over: Partial<PublishRequest> = {}): PublishRequest {
  return {
    text: 'Black Friday: 3-in-1 coffee, 30% off #coffee',
    media: [],
    options: {},
    account: { accessToken: 'tok', accountId: 'acct', username: 'brand', meta: {} },
    settings,
    fetchImpl,
    heartbeat: async () => undefined,
    ...over
  };
}

const bodyJson = (c: Call) => JSON.parse(String(c.body));
const form = (c: Call) => Object.fromEntries(new URLSearchParams(String(c.body)));

async function main() {
  // -------------------------------------------------------------------------
  await test('Rules: X counts links as 23 and blocks long captions', () => {
    assert.equal(xLength('hello https://example.com/a/very/long/path/that/is/long'), 6 + 23);
    assert.ok(hasErrors(validatePost('x', { text: 'a'.repeat(281), media: [] })));
    assert.ok(!hasErrors(validatePost('x', { text: 'a'.repeat(280), media: [] })));
    const p = validatePost('x', { text: 'see https://shop.example', media: [] });
    assert.ok(p.some((x) => x.level === 'warning' && /link/.test(x.message)));
  });

  await test('Rules: Instagram needs media, ratio and hashtag limits; TikTok/YouTube need video', () => {
    assert.ok(hasErrors(validatePost('instagram', { text: 'hi', media: [] })));
    assert.ok(hasErrors(validatePost('instagram', { text: 'hi', media: [{ kind: 'image', mime: 'image/png', size: 1000, width: 3000, height: 1000 }] })), 'too wide');
    assert.ok(!hasErrors(validatePost('instagram', { text: 'hi', media: [{ kind: 'image', mime: 'image/png', size: 1000, width: 1080, height: 1350 }] })));
    assert.ok(hasErrors(validatePost('instagram', { text: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '), media: [{ kind: 'image', mime: 'image/jpeg', size: 10 }] })));
    assert.ok(hasErrors(validatePost('tiktok', { text: 'x', media: [{ kind: 'image', mime: 'image/png', size: 10 }] })));
    assert.ok(!hasErrors(validatePost('tiktok', { text: 'x', media: [{ kind: 'video', mime: 'video/mp4', size: 10 }] })));
    assert.ok(hasErrors(validatePost('youtube', { text: '', media: [{ kind: 'video', mime: 'video/mp4', size: 10 }] })), 'title required');
    assert.ok(!hasErrors(validatePost('youtube', { text: '', title: 'Promo', media: [{ kind: 'video', mime: 'video/mp4', size: 10 }] })));
    assert.ok(hasErrors(validatePost('linkedin', { text: 'x', media: [{ kind: 'image', mime: 'image/png', size: 10 }, { kind: 'video', mime: 'video/mp4', size: 10 }] })), 'no mixing');
    assert.ok(hasErrors(validatePost('facebook', { text: '', media: [] })), 'empty post');
  });

  await test('Secrets: encrypt/decrypt round trip, masking, PKCE', () => {
    const enc = encryptSecret('top-secret-token');
    assert.ok(enc.startsWith('g1:') && !enc.includes('top-secret'));
    assert.equal(decryptSecret(enc), 'top-secret-token');
    assert.throws(() => decryptSecret(enc.slice(0, -4) + 'AAAA'));
    assert.equal(maskSecret('abcdefghijkl'), 'abc…jkl');
    const { verifier, challenge } = pkcePair();
    assert.ok(verifier.length >= 43 && challenge.length === 43);
  });

  await test('Registry: every platform has a plug-in', () => {
    for (const p of PLATFORMS) assert.ok(ADAPTERS[PLATFORM_PROVIDER[p]].platforms.includes(p), p);
  });

  // -------------------------------------------------------------------------
  await test('X: sign-in URL uses PKCE; text post and image upload requests', async () => {
    const url = new URL(xAdapter.buildAuthorizeUrl({ settings, redirectUri: 'https://app/cb', state: 's1', codeChallenge: 'ch' }));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('scope')!.includes('offline.access'));
    const { fetchImpl, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/2/media/upload/initialize')) return { json: { data: { id: 'm1' } } };
      if (c.url.includes('/append')) return { json: {} };
      if (c.url.endsWith('/finalize')) return { json: { data: { id: 'm1' } } };
      if (c.url.endsWith('/2/tweets')) return { status: 201, json: { data: { id: '99' } } };
      return { status: 404 };
    });
    const r = await xAdapter.publish('x', req(fetchImpl, { media: [file('image', 1000)] }));
    assert.equal(r.url, 'https://x.com/brand/status/99');
    const tweet = calls.find((c) => c.url.endsWith('/2/tweets'))!;
    assert.deepEqual(bodyJson(tweet), { text: 'Black Friday: 3-in-1 coffee, 30% off #coffee', media: { media_ids: ['m1'] } });
    assert.equal(tweet.headers.Authorization, 'Bearer tok');
    assert.equal(bodyJson(calls[0]).media_category, 'tweet_image');
  });

  await test('LinkedIn: hashtags, version, company-page image post', async () => {
    assert.equal(escapeLittleText('Sale (today) #coffee @shop'), 'Sale \\(today\\) {hashtag|\\#|coffee} \\@shop');
    assert.equal(linkedinVersion(undefined, new Date('2026-11-17T00:00:00Z')), '202609');
    assert.equal(linkedinVersion('202601'), '202601');
    const { fetchImpl, calls } = fakeFetch((c) => {
      if (c.url.includes('/rest/images?action=initializeUpload')) return { json: { value: { uploadUrl: 'https://upload.example/img', image: 'urn:li:image:1' } } };
      if (c.url === 'https://upload.example/img') return { status: 201 };
      if (c.url.endsWith('/rest/posts')) return { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } };
      return { status: 404 };
    });
    const r = await linkedinAdapter.publish('linkedin', req(fetchImpl, { media: [file('image', 500)], account: { accessToken: 't', accountId: 'urn:li:organization:5', meta: {} } }));
    assert.equal(r.url, 'https://www.linkedin.com/feed/update/urn:li:share:7');
    const post = calls.find((c) => c.url.endsWith('/rest/posts'))!;
    const b = bodyJson(post);
    assert.equal(b.author, 'urn:li:organization:5');
    assert.deepEqual(b.content, { media: { id: 'urn:li:image:1' } });
    assert.ok(/^\d{6}$/.test(post.headers['LinkedIn-Version']));
    assert.ok(linkedinAdapter.buildAuthorizeUrl({ settings: { ...settings, options: { companyPages: true } }, redirectUri: 'r', state: 's', codeChallenge: 'c' }).includes('w_organization_social'));
  });

  await test('Meta: Facebook text post and Instagram single image (container → publish)', async () => {
    const { fetchImpl, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/123/feed')) return { json: { id: '123_456' } };
      if (c.url.endsWith('/ig1/media')) return { json: { id: 'cont1' } };
      if (c.url.includes('/cont1?fields=status_code')) return { json: { status_code: 'FINISHED' } };
      if (c.url.endsWith('/ig1/media_publish')) return { json: { id: 'media9' } };
      if (c.url.includes('/media9?fields=permalink')) return { json: { permalink: 'https://instagram.com/p/abc' } };
      return { status: 404 };
    });
    const fb = await metaAdapter.publish('facebook', req(fetchImpl, { account: { accessToken: 'pagetok', accountId: '123', meta: {} } }));
    assert.equal(fb.url, 'https://www.facebook.com/123_456');
    assert.equal(form(calls[0]).message, 'Black Friday: 3-in-1 coffee, 30% off #coffee');
    const ig = await metaAdapter.publish('instagram', req(fetchImpl, { media: [file('image', 100)], account: { accessToken: 'pagetok', accountId: 'ig1', meta: {} } }));
    assert.equal(ig.url, 'https://instagram.com/p/abc');
    const create = calls.find((c) => c.url.endsWith('/ig1/media'))!;
    assert.equal(form(create).image_url, 'https://files.example/image.jpg', 'Instagram gets the JPEG version');
  });

  await test('TikTok: chunk plan, direct post init, upload, status check', async () => {
    assert.deepEqual(tiktokChunks(10 * 1024 * 1024).count, 1);
    const big = tiktokChunks(105 * 1024 * 1024);
    assert.equal(big.count, 10);
    assert.equal(big.ranges[9][1], 105 * 1024 * 1024 - 1, 'last chunk takes the remainder');
    const { fetchImpl, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/video/init/')) return { json: { data: { publish_id: 'p1', upload_url: 'https://up.tiktok/1' }, error: { code: 'ok' } } };
      if (c.url === 'https://up.tiktok/1') return { status: 201 };
      if (c.url.endsWith('/status/fetch/')) return { json: { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [777] }, error: { code: 'ok' } } };
      return { status: 404 };
    });
    await assert.rejects(() => tiktokAdapter.publish('tiktok', req(fetchImpl, { media: [file('video', 2000)] })), /who can see/);
    const r = await tiktokAdapter.publish('tiktok', req(fetchImpl, { media: [file('video', 2000)], options: { privacy: 'PUBLIC_TO_EVERYONE', disableDuet: true } }));
    assert.deepEqual(r, { remoteId: 'p1', pending: true });
    const init = bodyJson(calls.find((c) => c.url.endsWith('/video/init/'))!);
    assert.equal(init.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
    assert.equal(init.post_info.disable_duet, true);
    assert.deepEqual(init.source_info, { source: 'FILE_UPLOAD', video_size: 2000, chunk_size: 2000, total_chunk_count: 1 });
    assert.equal(calls.find((c) => c.url === 'https://up.tiktok/1')!.headers['Content-Range'], 'bytes 0-1999/2000');
    const done = await tiktokAdapter.checkStatus!('tiktok', { account: { accessToken: 't', accountId: 'o', username: 'brand', meta: {} }, remoteId: 'p1', settings, fetchImpl });
    assert.equal(done.url, 'https://www.tiktok.com/@brand/video/777');
  });

  await test('YouTube: resumable upload in chunks', async () => {
    const size = 20 * 1024 * 1024;
    const { fetchImpl, calls } = fakeFetch((c) => {
      if (c.url.includes('uploadType=resumable')) return { headers: { Location: 'https://upload.yt/session' } };
      if (c.url === 'https://upload.yt/session') return String(c.headers['Content-Range']).startsWith('bytes 0-') ? { status: 308 } : { status: 200, json: { id: 'vid1' } };
      return { status: 404 };
    });
    await assert.rejects(() => youtubeAdapter.publish('youtube', req(fetchImpl, { media: [file('video', size)] })), /title/);
    const r = await youtubeAdapter.publish('youtube', req(fetchImpl, { media: [file('video', size)], options: { title: 'Black Friday', privacy: 'unlisted' } }));
    assert.equal(r.url, 'https://www.youtube.com/watch?v=vid1');
    const meta = bodyJson(calls.find((c) => c.url.includes('uploadType=resumable'))!);
    assert.equal(meta.status.privacyStatus, 'unlisted');
    assert.equal(calls.filter((c) => c.url === 'https://upload.yt/session').length, 2, 'two chunks');
  });

  await test('Errors: expired tokens ask to reconnect; 5xx is retried', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, json: { error: { message: 'expired' } } }));
    await assert.rejects(() => xAdapter.publish('x', req(fetchImpl)), (e: any) => e.opts?.reconnect === true);
    const f2 = fakeFetch(() => ({ status: 503, json: {} }));
    await assert.rejects(() => xAdapter.publish('x', req(f2.fetchImpl)), (e: any) => e.opts?.retryable === true);
  });

  await test('Test channels: simulate success, and failure with #fail', async () => {
    const ok = await simulatePublish('instagram', req(fakeFetch(() => ({})).fetchImpl, { media: [file('image', 10)] }));
    assert.ok(ok.url?.includes('/test-post/instagram/'));
    await assert.rejects(() => simulatePublish('x', req(fakeFetch(() => ({})).fetchImpl, { text: 'oops #fail' })), /on purpose/);
  });

  await test('Canva: design size limits and return token parsing', () => {
    assert.deepEqual(canvaDesignSize(1080, 1350), { width: 1080, height: 1350 });
    assert.deepEqual(canvaDesignSize(16000, 8000), { width: 8000, height: 4000 });
    assert.deepEqual(canvaDesignSize(20, 10), { width: 80, height: 40 });
    const jwt = `x.${Buffer.from(JSON.stringify({ correlation_state: 'abc', design_id: 'D1' })).toString('base64url')}.sig`;
    assert.deepEqual(correlationFromJwt(jwt), { correlationState: 'abc', designId: 'D1' });
    assert.deepEqual(correlationFromJwt('garbage'), {});
  });

  await test('Tools: publishing tools are gated and schedule_post sends the right request', async () => {
    const { TOOLS } = await import('../mcp/tools');
    const names = ['list_publishing_channels', 'schedule_post', 'list_posts', 'cancel_post'];
    const user = { id: 'u1', email: 'a@b.c', name: 'Ada', role: 'hybrid', accessMode: 'part_two', canUseAI: false, canUseLibrary: true, canUsePublishing: true };
    const calls: any[] = [];
    const api = {
      request: async (method: string, path: string, opts: any = {}) => {
        calls.push({ method, path, ...opts });
        if (path.endsWith('/media')) return { task: { content: 'Task caption' }, media: [{ source: 'url', url: 'https://bucket/img.png', isMain: true }] };
        if (path === '/api/publishing/posts' && method === 'POST') {
          return { posts: [{ id: 'p1', platformName: 'X', channel: { name: 'Brand' }, status: 'scheduled', scheduledAt: '2026-11-27T06:00:00.000Z', media: [{}], task: { id: 't1', name: 'BF' } }] };
        }
        return {};
      }
    };
    const on: any = { api, user, appUrl: 'https://app' };
    const off: any = { api, user: { ...user, canUsePublishing: false }, appUrl: 'https://app' };
    for (const n of names) {
      const t = TOOLS.find((x) => x.name === n)!;
      assert.ok(t, n);
      assert.equal(t.isAvailable!(on), true);
      assert.equal(t.isAvailable!(off), false);
    }
    const schedule = TOOLS.find((x) => x.name === 'schedule_post')!;
    assert.equal(schedule.annotations.destructiveHint, true, 'assistants confirm before posting');
    const out: any = await schedule.handler(
      { task_id: '0123456789abcdef01234567', account_ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'], post_by_hand_on: ['instagram'], when: 'schedule', scheduled_at: '2026-11-27T09:00:00+03:00' },
      on
    );
    const post = calls.find((c) => c.path === '/api/publishing/posts')!;
    assert.deepEqual(post.body.targets, [{ channelId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, { platform: 'instagram' }]);
    assert.equal(post.body.text, 'Task caption');
    assert.deepEqual(post.body.media, [{ source: 'url', url: 'https://bucket/img.png', assetId: undefined }]);
    assert.equal(out.posts[0].account, 'Brand');
    await assert.rejects(() => schedule.handler({ task_id: '0123456789abcdef01234567', when: 'now' }, on), /at least one/);
  });

  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`Publishing self-test: all ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
