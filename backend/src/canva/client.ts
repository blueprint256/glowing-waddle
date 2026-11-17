import { AppConfig } from '../models/AppConfig';
import { User, IUser } from '../models/User';
import { encryptSecret, decryptSecret } from '../publishing/secrets';
import { http, expiresFrom, sleep } from '../publishing/http';
import { FetchLike, PublishError } from '../publishing/types';
export { canvaDesignSize, correlationFromJwt } from './helpers';

/**
 * Canva Connect (REST) client: sign-in with PKCE, send a picture into Canva as a new design, export the
 * edited design back. Each user signs in with their own Canva account; nothing runs on our servers
 * except the upload and download of one image.
 * Docs: https://www.canva.dev/docs/connect/
 */

const API = 'https://api.canva.com/rest/v1';
export const CANVA_SCOPES = ['asset:read', 'asset:write', 'design:meta:read', 'design:content:read', 'design:content:write', 'profile:read'];
const defaultFetch: FetchLike = (url, init) => fetch(url, init) as any;

export interface CanvaSettings {
  clientId: string;
  clientSecret: string;
  ready: boolean;
  source: 'settings' | 'env' | 'none';
}

export async function loadCanvaSettings(): Promise<CanvaSettings> {
  const config = await AppConfig.getConfig();
  let secret = '';
  try {
    secret = decryptSecret(config.canvaClientSecretEnc);
  } catch {
    secret = '';
  }
  if (config.canvaClientId && secret) return { clientId: config.canvaClientId, clientSecret: secret, ready: true, source: 'settings' };
  const envId = process.env.CANVA_CLIENT_ID || '';
  const envSecret = process.env.CANVA_CLIENT_SECRET || '';
  const placeholder = /^your-/i;
  if (envId && envSecret && !placeholder.test(envId) && !placeholder.test(envSecret)) return { clientId: envId, clientSecret: envSecret, ready: true, source: 'env' };
  return { clientId: '', clientSecret: '', ready: false, source: 'none' };
}

function basic(s: CanvaSettings) {
  return `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString('base64')}`;
}

export function canvaAuthorizeUrl(s: CanvaSettings, redirectUri: string, state: string, codeChallenge: string): string {
  const q = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
    scope: CANVA_SCOPES.join(' '),
    response_type: 'code',
    client_id: s.clientId,
    state,
    redirect_uri: redirectUri
  });
  return `https://www.canva.com/api/oauth/authorize?${q}`;
}

export async function canvaExchangeCode(s: CanvaSettings, code: string, codeVerifier: string, redirectUri: string, fetchImpl: FetchLike = defaultFetch) {
  const r = await http(fetchImpl, 'Canva sign-in', `${API}/oauth/token`, {
    headers: { Authorization: basic(s) },
    form: { grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri }
  });
  return { accessToken: r.json.access_token as string, refreshToken: r.json.refresh_token as string, expiresAt: expiresFrom(r.json.expires_in) };
}

export async function saveCanvaTokens(userId: unknown, t: { accessToken: string; refreshToken?: string; expiresAt: Date | null }) {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'integrations.canva.accessToken': encryptSecret(t.accessToken),
        'integrations.canva.refreshToken': t.refreshToken ? encryptSecret(t.refreshToken) : undefined,
        'integrations.canva.expiresAt': t.expiresAt || undefined,
        'integrations.canva.connected': true,
        'integrations.canva.connectedAt': new Date()
      }
    }
  );
}

export async function clearCanvaTokens(userId: unknown) {
  await User.updateOne({ _id: userId }, { $set: { 'integrations.canva': { connected: false } } });
}

/** A valid access token for this user, refreshing it when needed. null = not connected. */
export async function canvaToken(user: IUser, fetchImpl: FetchLike = defaultFetch): Promise<string | null> {
  const fresh = await User.findById(user._id).select('integrations');
  const c = fresh?.integrations?.canva;
  if (!c?.connected || !c.accessToken) return null;
  let access = '';
  let refresh = '';
  try {
    access = decryptSecret(c.accessToken);
    refresh = c.refreshToken ? decryptSecret(c.refreshToken) : '';
  } catch {
    // Tokens saved by the old demo connection (not encrypted, not real): ask the user to reconnect.
    await clearCanvaTokens(user._id);
    return null;
  }
  if (c.expiresAt && c.expiresAt.getTime() < Date.now() + 60_000) {
    if (!refresh) {
      await clearCanvaTokens(user._id);
      return null;
    }
    const s = await loadCanvaSettings();
    const r = await http(fetchImpl, 'Canva sign-in refresh', `${API}/oauth/token`, {
      headers: { Authorization: basic(s) },
      form: { grant_type: 'refresh_token', refresh_token: refresh },
      allowError: true
    });
    if (!r.ok || !r.json.access_token) {
      await clearCanvaTokens(user._id);
      return null;
    }
    // Canva refresh tokens are single-use: always store the new one.
    await saveCanvaTokens(user._id, { accessToken: r.json.access_token, refreshToken: r.json.refresh_token || refresh, expiresAt: expiresFrom(r.json.expires_in) });
    access = r.json.access_token;
  }
  return access;
}

/** Upload a picture to the user's Canva uploads; returns the Canva asset id. */
export async function canvaUploadAsset(token: string, image: Buffer, name: string, fetchImpl: FetchLike = defaultFetch): Promise<string> {
  const safe = name.replace(/\.[a-z0-9]+$/i, '').slice(0, 50) || 'Blueprint image';
  const r = await http(fetchImpl, 'Canva upload', `${API}/asset-uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Asset-Upload-Metadata': JSON.stringify({ name_base64: Buffer.from(safe).toString('base64') })
    },
    body: image,
    timeoutMs: 120_000
  });
  let job = r.json.job;
  for (let i = 0; job && job.status === 'in_progress' && i < 30; i++) {
    await sleep(i < 5 ? 1000 : 2000);
    job = (await http(fetchImpl, 'Canva upload', `${API}/asset-uploads/${job.id}`, { headers: { Authorization: `Bearer ${token}` } })).json.job;
  }
  if (job?.status !== 'success' || !job.asset?.id) throw new PublishError(`Canva could not take the picture: ${job?.error?.message || job?.status || 'unknown error'}`);
  return job.asset.id;
}

export async function canvaCreateDesign(token: string, assetId: string, title: string, size: { width: number; height: number }, fetchImpl: FetchLike = defaultFetch) {
  const r = await http(fetchImpl, 'Canva', `${API}/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    json: { design_type: { type: 'custom', width: size.width, height: size.height }, asset_id: assetId, title: title.slice(0, 255) || 'Blueprint design' }
  });
  const d = r.json.design;
  if (!d?.id || !d.urls?.edit_url) throw new PublishError('Canva did not return a design');
  return { designId: d.id as string, editUrl: d.urls.edit_url as string };
}

/** Export a design as PNG (first page) and download it. */
export async function canvaExportPng(token: string, designId: string, fetchImpl: FetchLike = defaultFetch): Promise<Buffer> {
  const r = await http(fetchImpl, 'Canva export', `${API}/exports`, {
    headers: { Authorization: `Bearer ${token}` },
    json: { design_id: designId, format: { type: 'png', pages: [1] } }
  });
  let job = r.json.job;
  for (let i = 0; job && job.status === 'in_progress' && i < 45; i++) {
    await sleep(i < 5 ? 1000 : 2000);
    job = (await http(fetchImpl, 'Canva export', `${API}/exports/${job.id}`, { headers: { Authorization: `Bearer ${token}` } })).json.job;
  }
  const url = job?.urls?.[0];
  if (job?.status !== 'success' || !url) throw new PublishError(`Canva could not export the design: ${job?.error?.message || job?.status || 'unknown error'}`);
  const res = await fetchImpl(url);
  if (!res.ok) throw new PublishError('Could not download the design from Canva', { retryable: true });
  const ab = await (res as any).arrayBuffer();
  return Buffer.from(ab);
}

