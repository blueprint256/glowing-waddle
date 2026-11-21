import { ProviderAdapter, ProviderId, PlatformId, PublishRequest, PublishResult, PublishError } from './types';
import { xAdapter } from './platforms/x';
import { linkedinAdapter } from './platforms/linkedin';
import { metaAdapter } from './platforms/meta';
import { tiktokAdapter } from './platforms/tiktok';
import { youtubeAdapter } from './platforms/youtube';
import { sleep } from './http';

/** All platform plug-ins. Adding a platform = one adapter file + one line here. */
export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  x: xAdapter,
  linkedin: linkedinAdapter,
  meta: metaAdapter,
  tiktok: tiktokAdapter,
  google: youtubeAdapter
};

export const PLATFORM_PROVIDER: Record<PlatformId, ProviderId> = {
  x: 'x',
  linkedin: 'linkedin',
  facebook: 'meta',
  instagram: 'meta',
  tiktok: 'tiktok',
  youtube: 'google'
};

export const PLATFORM_NAMES: Record<PlatformId, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube'
};

export function adapterFor(platform: PlatformId): ProviderAdapter {
  return ADAPTERS[PLATFORM_PROVIDER[platform]];
}

/**
 * Test channels (test mode): go through the whole pipeline — validation, scheduling, media loading,
 * retries, status — but nothing leaves the app. A caption containing "#fail" fails on purpose so the
 * failure path can be shown too.
 */
export async function simulatePublish(platform: PlatformId, req: PublishRequest): Promise<PublishResult> {
  for (const m of req.media) await m.read(0, Math.min(m.size, 1024) - 1);
  await req.heartbeat('Test channel: pretending to upload');
  await sleep(800);
  if (/#fail\b/i.test(req.text)) throw new PublishError('Test channel: this post failed on purpose (#fail in the caption)');
  const id = `test-${Date.now().toString(36)}`;
  return { remoteId: id, url: `https://example.com/test-post/${platform}/${id}` };
}
