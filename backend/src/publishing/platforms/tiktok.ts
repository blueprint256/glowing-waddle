import { ProviderAdapter, PublishError, PublishRequest } from '../types';
import { http, expiresFrom } from '../http';

/**
 * TikTok — Content Posting API, Direct Post of videos uploaded from our storage (FILE_UPLOAD).
 * Until TikTok audits the app, every post is private (SELF_ONLY) and at most 5 creators a day can post.
 * The audit checks the posting screen: creator name shown, privacy chosen by the user from the
 * creator's own options (no default), interaction toggles, commercial-content disclosure, preview and
 * consent. The publish dialog implements these using accountOptions() below.
 * Docs: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */

const API = 'https://open.tiktokapis.com';
const SCOPES = ['user.info.basic', 'video.publish', 'video.upload'];
const MB = 1024 * 1024;

/** TikTok chunk rules: 5–64 MB chunks; files up to 64 MB go in one chunk; the last chunk carries the remainder. */
export function tiktokChunks(size: number): { chunkSize: number; count: number; ranges: [number, number][] } {
  if (size <= 64 * MB) return { chunkSize: size, count: 1, ranges: [[0, size - 1]] };
  const chunkSize = 10 * MB;
  const count = Math.floor(size / chunkSize);
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) ranges.push([i * chunkSize, i === count - 1 ? size - 1 : (i + 1) * chunkSize - 1]);
  return { chunkSize, count, ranges };
}

function tiktokError(json: any): string | null {
  const code = json?.error?.code;
  return code && code !== 'ok' ? `${code}: ${json.error.message || ''}`.trim() : null;
}

export const tiktokAdapter: ProviderAdapter = {
  id: 'tiktok',
  name: 'TikTok',
  platforms: ['tiktok'],
  developerPortal: 'https://developers.tiktok.com/apps',
  approvalNote:
    'Add Login Kit and the Content Posting API (Direct Post) to your app; TikTok reviews the app (several days to two weeks). Posts stay private until TikTok also audits it for public posting.',

  buildAuthorizeUrl({ settings, redirectUri, state }) {
    const q = new URLSearchParams({ client_key: settings.clientId, response_type: 'code', scope: SCOPES.join(','), redirect_uri: redirectUri, state });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  },

  async exchangeCode({ settings, redirectUri, code, fetchImpl }) {
    const r = await http(fetchImpl, 'TikTok sign-in', `${API}/v2/oauth/token/`, {
      form: { client_key: settings.clientId, client_secret: settings.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }
    });
    if (!r.json.access_token) throw new PublishError(`TikTok sign-in failed: ${r.json.error_description || r.json.error || 'no token'}`);
    return {
      accessToken: r.json.access_token,
      refreshToken: r.json.refresh_token,
      expiresAt: expiresFrom(r.json.expires_in),
      scopes: String(r.json.scope || '').split(',')
    };
  },

  async discoverAccounts({ tokens, fetchImpl }) {
    const r = await http(fetchImpl, 'TikTok profile', `${API}/v2/user/info/?fields=open_id,avatar_url,display_name,username`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` }
    });
    const u = r.json?.data?.user || {};
    return [
      {
        platform: 'tiktok',
        accountId: u.open_id,
        name: u.display_name || u.username || 'TikTok account',
        username: u.username,
        avatarUrl: u.avatar_url,
        accountType: 'creator',
        ...tokens
      }
    ];
  },

  async refresh({ settings, account, fetchImpl }) {
    if (!account.refreshToken) return null;
    const r = await http(fetchImpl, 'TikTok sign-in refresh', `${API}/v2/oauth/token/`, {
      form: { client_key: settings.clientId, client_secret: settings.clientSecret, grant_type: 'refresh_token', refresh_token: account.refreshToken }
    });
    if (!r.json.access_token) throw new PublishError('TikTok sign-in expired; reconnect the account', { reconnect: true });
    return { accessToken: r.json.access_token, refreshToken: r.json.refresh_token || account.refreshToken, expiresAt: expiresFrom(r.json.expires_in) };
  },

  /** The creator's live settings the posting screen must respect (TikTok audit requirement). */
  async accountOptions(_platform, { account, fetchImpl }) {
    const r = await http(fetchImpl, 'TikTok', `${API}/v2/post/publish/creator_info/query/`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      json: {}
    });
    const err = tiktokError(r.json);
    if (err) throw new PublishError(`TikTok: ${err}`);
    const d = r.json.data || {};
    return {
      creatorName: d.creator_nickname,
      creatorUsername: d.creator_username,
      creatorAvatar: d.creator_avatar_url,
      privacyOptions: d.privacy_level_options || [],
      commentDisabled: Boolean(d.comment_disabled),
      duetDisabled: Boolean(d.duet_disabled),
      stitchDisabled: Boolean(d.stitch_disabled),
      maxVideoSeconds: d.max_video_post_duration_sec
    };
  },

  async publish(_platform, req: PublishRequest) {
    const video = req.media.find((m) => m.kind === 'video');
    if (!video) throw new PublishError('TikTok posts need a video');
    if (!req.options.privacy) throw new PublishError('Choose who can see this TikTok post');
    const chunks = tiktokChunks(video.size);
    const auth = { Authorization: `Bearer ${req.account.accessToken}` };
    const init = await http(req.fetchImpl, 'TikTok', `${API}/v2/post/publish/video/init/`, {
      headers: auth,
      json: {
        post_info: {
          title: req.text.slice(0, 2200),
          privacy_level: req.options.privacy,
          disable_comment: Boolean(req.options.disableComments),
          disable_duet: Boolean(req.options.disableDuet),
          disable_stitch: Boolean(req.options.disableStitch),
          brand_content_toggle: Boolean(req.options.brandedContent),
          brand_organic_toggle: Boolean(req.options.brandOrganic)
        },
        source_info: { source: 'FILE_UPLOAD', video_size: video.size, chunk_size: chunks.chunkSize, total_chunk_count: chunks.count }
      }
    });
    const err = tiktokError(init.json);
    if (err) throw new PublishError(`TikTok: ${err}`, { reconnect: /token/i.test(err) });
    const { publish_id: publishId, upload_url: uploadUrl } = init.json.data || {};
    if (!publishId || !uploadUrl) throw new PublishError('TikTok did not return an upload link');
    for (let i = 0; i < chunks.ranges.length; i++) {
      const [start, end] = chunks.ranges[i];
      await http(req.fetchImpl, 'TikTok upload', uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': video.mime, 'Content-Range': `bytes ${start}-${end}/${video.size}` },
        body: await video.read(start, end),
        timeoutMs: 180_000
      });
      await req.heartbeat(`Uploading to TikTok (${Math.round(((i + 1) / chunks.ranges.length) * 100)}%)`);
    }
    // TikTok processes the video after upload; the scheduler checks back with checkStatus.
    return { remoteId: publishId, pending: true };
  },

  async checkStatus(_platform, { account, remoteId, fetchImpl }) {
    const r = await http(fetchImpl, 'TikTok', `${API}/v2/post/publish/status/fetch/`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      json: { publish_id: remoteId }
    });
    const d = r.json.data || {};
    if (d.status === 'FAILED') throw new PublishError(`TikTok could not publish the video: ${d.fail_reason || 'unknown reason'}`);
    if (d.status === 'PUBLISH_COMPLETE') {
      const postId = (d.publicaly_available_post_id || [])[0];
      return {
        remoteId: postId ? String(postId) : remoteId,
        url: postId && account.username ? `https://www.tiktok.com/@${account.username}/video/${postId}` : undefined
      };
    }
    return { remoteId, pending: true };
  }
};
