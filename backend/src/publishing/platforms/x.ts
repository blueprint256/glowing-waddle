import { ProviderAdapter, PublishError, MediaFile, PublishRequest } from '../types';
import { http, expiresFrom, sleep } from '../http';

/**
 * X (Twitter) — API v2 with OAuth 2.0 (PKCE). No approval review: X bills per post (pay-per-use).
 * Docs: https://docs.x.com/x-api/posts/manage-tweets/introduction
 */

const API = 'https://api.x.com';
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
const CHUNK = 4 * 1024 * 1024;

function basic(clientId: string, secret: string) {
  return `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`;
}

async function uploadMedia(req: PublishRequest, file: MediaFile): Promise<string> {
  const auth = { Authorization: `Bearer ${req.account.accessToken}` };
  const category = file.kind === 'video' ? 'tweet_video' : file.mime === 'image/gif' ? 'tweet_gif' : 'tweet_image';
  const init = await http(req.fetchImpl, 'X media upload', `${API}/2/media/upload/initialize`, {
    headers: auth,
    json: { media_type: file.mime, total_bytes: file.size, media_category: category }
  });
  const id: string = init.json?.data?.id;
  if (!id) throw new PublishError('X media upload: no media id returned');
  for (let start = 0, index = 0; start < file.size; start += CHUNK, index++) {
    const chunk = await file.read(start, Math.min(file.size, start + CHUNK) - 1);
    const form = new FormData();
    form.append('segment_index', String(index));
    form.append('media', new Blob([new Uint8Array(chunk)]), file.name);
    await http(req.fetchImpl, 'X media upload', `${API}/2/media/upload/${id}/append`, { method: 'POST', headers: auth, body: form, timeoutMs: 120_000 });
    await req.heartbeat(`Uploading to X (${Math.min(100, Math.round(((start + CHUNK) / file.size) * 100))}%)`);
  }
  const fin = await http(req.fetchImpl, 'X media upload', `${API}/2/media/upload/${id}/finalize`, { method: 'POST', headers: auth });
  let info = fin.json?.data?.processing_info;
  for (let i = 0; info && info.state !== 'succeeded' && i < 60; i++) {
    if (info.state === 'failed') throw new PublishError(`X could not process ${file.name}: ${info.error?.message || 'unknown error'}`);
    await sleep(Math.max(1, Number(info.check_after_secs) || 3) * 1000);
    await req.heartbeat('X is processing the video');
    const s = await http(req.fetchImpl, 'X media status', `${API}/2/media/upload?command=STATUS&media_id=${id}`, { headers: auth });
    info = s.json?.data?.processing_info;
  }
  return id;
}

export const xAdapter: ProviderAdapter = {
  id: 'x',
  name: 'X',
  platforms: ['x'],
  developerPortal: 'https://developer.x.com/en/portal/dashboard',
  approvalNote: 'No review needed. X charges per post from your prepaid API credits (about $0.015 a post, more with a link).',

  buildAuthorizeUrl({ settings, redirectUri, state, codeChallenge }) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },

  async exchangeCode({ settings, redirectUri, code, codeVerifier, fetchImpl }) {
    const r = await http(fetchImpl, 'X sign-in', `${API}/2/oauth2/token`, {
      headers: { Authorization: basic(settings.clientId, settings.clientSecret) },
      form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: settings.clientId }
    });
    return { accessToken: r.json.access_token, refreshToken: r.json.refresh_token, expiresAt: expiresFrom(r.json.expires_in), scopes: String(r.json.scope || '').split(' ') };
  },

  async discoverAccounts({ tokens, fetchImpl }) {
    const r = await http(fetchImpl, 'X profile', `${API}/2/users/me?user.fields=profile_image_url`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    const u = r.json.data;
    return [
      {
        platform: 'x',
        accountId: u.id,
        name: u.name,
        username: u.username,
        avatarUrl: u.profile_image_url,
        accountType: 'person',
        ...tokens
      }
    ];
  },

  async refresh({ settings, account, fetchImpl }) {
    if (!account.refreshToken) return null;
    const r = await http(fetchImpl, 'X sign-in refresh', `${API}/2/oauth2/token`, {
      headers: { Authorization: basic(settings.clientId, settings.clientSecret) },
      form: { grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: settings.clientId }
    });
    return { accessToken: r.json.access_token, refreshToken: r.json.refresh_token || account.refreshToken, expiresAt: expiresFrom(r.json.expires_in) };
  },

  async publish(_platform, req) {
    const mediaIds: string[] = [];
    for (const file of req.media) mediaIds.push(await uploadMedia(req, file));
    const body: Record<string, unknown> = {};
    if (req.text.trim()) body.text = req.text;
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    const r = await http(req.fetchImpl, 'X', `${API}/2/tweets`, { headers: { Authorization: `Bearer ${req.account.accessToken}` }, json: body });
    const id = r.json?.data?.id;
    if (!id) throw new PublishError('X accepted the request but returned no post id');
    return { remoteId: id, url: `https://x.com/${req.account.username || 'i/web'}/status/${id}` };
  }
};
