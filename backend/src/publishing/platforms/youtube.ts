import { ProviderAdapter, PublishError, PublishRequest } from '../types';
import { http, expiresFrom } from '../http';

/**
 * YouTube — Data API v3 resumable upload. Google OAuth app verification is needed for more than 100
 * users, and videos stay private until the project passes the YouTube API compliance audit.
 * Vertical videos up to 3 minutes appear as Shorts automatically.
 * Docs: https://developers.google.com/youtube/v3/docs/videos/insert
 */

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const CHUNK = 16 * 1024 * 1024; // multiple of 256 KiB, as Google requires

export const youtubeAdapter: ProviderAdapter = {
  id: 'google',
  name: 'Google (YouTube)',
  platforms: ['youtube'],
  developerPortal: 'https://console.cloud.google.com/apis/credentials',
  approvalNote:
    'Enable the YouTube Data API v3 and create an OAuth client. Google verifies the sign-in screen before more than 100 people can connect, and uploads stay private until the YouTube API compliance audit is passed.',

  buildAuthorizeUrl({ settings, redirectUri, state, codeChallenge }) {
    const q = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },

  async exchangeCode({ settings, redirectUri, code, codeVerifier, fetchImpl }) {
    const r = await http(fetchImpl, 'Google sign-in', 'https://oauth2.googleapis.com/token', {
      form: {
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier
      }
    });
    return { accessToken: r.json.access_token, refreshToken: r.json.refresh_token, expiresAt: expiresFrom(r.json.expires_in), scopes: String(r.json.scope || '').split(' ') };
  },

  async discoverAccounts({ tokens, fetchImpl }) {
    const r = await http(fetchImpl, 'YouTube channels', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` }
    });
    const items = r.json.items || [];
    if (!items.length) throw new PublishError('This Google account has no YouTube channel yet. Create one on YouTube, then connect again.');
    return items.map((c: any) => ({
      platform: 'youtube' as const,
      accountId: c.id,
      name: c.snippet?.title || 'YouTube channel',
      username: c.snippet?.customUrl,
      avatarUrl: c.snippet?.thumbnails?.default?.url,
      accountType: 'channel' as const,
      ...tokens
    }));
  },

  async refresh({ settings, account, fetchImpl }) {
    if (!account.refreshToken) return null;
    const r = await http(fetchImpl, 'Google sign-in refresh', 'https://oauth2.googleapis.com/token', {
      form: { client_id: settings.clientId, client_secret: settings.clientSecret, refresh_token: account.refreshToken, grant_type: 'refresh_token' }
    });
    return { accessToken: r.json.access_token, refreshToken: account.refreshToken, expiresAt: expiresFrom(r.json.expires_in) };
  },

  async publish(_platform, req: PublishRequest) {
    const video = req.media.find((m) => m.kind === 'video');
    if (!video) throw new PublishError('YouTube posts need a video');
    const title = (req.options.title || '').trim();
    if (!title) throw new PublishError('YouTube needs a title');
    const auth = { Authorization: `Bearer ${req.account.accessToken}` };
    const start = await http(req.fetchImpl, 'YouTube', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      headers: { ...auth, 'X-Upload-Content-Type': video.mime, 'X-Upload-Content-Length': String(video.size) },
      json: {
        snippet: { title: title.slice(0, 100), description: req.text.slice(0, 5000), categoryId: '22' },
        status: { privacyStatus: ['public', 'unlisted', 'private'].includes(req.options.privacy || '') ? req.options.privacy : 'public', selfDeclaredMadeForKids: Boolean(req.options.madeForKids) }
      }
    });
    const uploadUrl = start.header('location');
    if (!uploadUrl) throw new PublishError('YouTube did not return an upload link');
    let result: any = null;
    for (let offset = 0; offset < video.size; offset += CHUNK) {
      const end = Math.min(video.size, offset + CHUNK) - 1;
      const r = await http(req.fetchImpl, 'YouTube upload', uploadUrl, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': video.mime, 'Content-Range': `bytes ${offset}-${end}/${video.size}` },
        body: await video.read(offset, end),
        timeoutMs: 300_000,
        allowError: true
      });
      // 308 = "keep going"; 200/201 = done.
      if (r.status === 200 || r.status === 201) {
        result = r.json;
        break;
      }
      if (r.status !== 308) throw new PublishError(`YouTube upload failed (${r.status}): ${r.json?.error?.message || r.text.slice(0, 200)}`, { retryable: r.status >= 500 });
      await req.heartbeat(`Uploading to YouTube (${Math.round(((end + 1) / video.size) * 100)}%)`);
    }
    if (!result?.id) throw new PublishError('YouTube finished the upload but returned no video id');
    return { remoteId: result.id, url: `https://www.youtube.com/watch?v=${result.id}` };
  }
};
