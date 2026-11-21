import { ProviderAdapter, PublishError, MediaFile, PublishRequest, DiscoveredAccount } from '../types';
import { http, expiresFrom, sleep } from '../http';

/**
 * LinkedIn — Posts API (/rest/posts). Posting as a person is self-serve ("Share on LinkedIn").
 * Posting as a company page needs the Community Management API (LinkedIn review), switched on with the
 * "Company pages" option once approved.
 * Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 */

const API = 'https://api.linkedin.com';

/** LinkedIn versions its API monthly (YYYYMM) and supports each for about a year. Default: two months ago. */
export function linkedinVersion(override?: unknown, now = new Date()): string {
  if (typeof override === 'string' && /^\d{6}$/.test(override)) return override;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function restHeaders(token: string, version: string) {
  return { Authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' };
}

async function uploadImage(req: PublishRequest, file: MediaFile, version: string): Promise<string> {
  const init = await http(req.fetchImpl, 'LinkedIn image upload', `${API}/rest/images?action=initializeUpload`, {
    headers: restHeaders(req.account.accessToken, version),
    json: { initializeUploadRequest: { owner: req.account.accountId } }
  });
  const { uploadUrl, image } = init.json?.value || {};
  if (!uploadUrl || !image) throw new PublishError('LinkedIn did not return an upload link');
  await http(req.fetchImpl, 'LinkedIn image upload', uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${req.account.accessToken}`, 'Content-Type': file.mime },
    body: await file.readAll(),
    timeoutMs: 120_000
  });
  return image;
}

async function uploadVideo(req: PublishRequest, file: MediaFile, version: string): Promise<string> {
  const headers = restHeaders(req.account.accessToken, version);
  const init = await http(req.fetchImpl, 'LinkedIn video upload', `${API}/rest/videos?action=initializeUpload`, {
    headers,
    json: { initializeUploadRequest: { owner: req.account.accountId, fileSizeBytes: file.size, uploadCaptions: false, uploadThumbnail: false } }
  });
  const v = init.json?.value || {};
  const parts: { uploadUrl: string; firstByte: number; lastByte: number }[] = v.uploadInstructions || [];
  if (!v.video || !parts.length) throw new PublishError('LinkedIn did not return upload instructions');
  const etags: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const res = await http(req.fetchImpl, 'LinkedIn video upload', p.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await file.read(p.firstByte, p.lastByte),
      timeoutMs: 180_000
    });
    etags.push(res.header('etag') || '');
    await req.heartbeat(`Uploading to LinkedIn (${Math.round(((i + 1) / parts.length) * 100)}%)`);
  }
  await http(req.fetchImpl, 'LinkedIn video upload', `${API}/rest/videos?action=finalizeUpload`, {
    headers,
    json: { finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken || '', uploadedPartIds: etags } }
  });
  // Wait until LinkedIn has processed the video, otherwise the post is rejected.
  for (let i = 0; i < 60; i++) {
    const s = await http(req.fetchImpl, 'LinkedIn video status', `${API}/rest/videos/${encodeURIComponent(v.video)}`, { headers, allowError: true });
    const status = s.json?.status;
    if (status === 'AVAILABLE') break;
    if (status === 'PROCESSING_FAILED') throw new PublishError('LinkedIn could not process the video');
    await sleep(5000);
    await req.heartbeat('LinkedIn is processing the video');
  }
  return v.video;
}

export const linkedinAdapter: ProviderAdapter = {
  id: 'linkedin',
  name: 'LinkedIn',
  platforms: ['linkedin'],
  developerPortal: 'https://www.linkedin.com/developers/apps',
  approvalNote:
    'Personal profiles work once "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" are added to your app (no review). Company pages need the Community Management API, which LinkedIn reviews: switch on "Company pages" here after approval.',
  optionFields: [
    { key: 'companyPages', label: 'Company pages (Community Management API approved)', type: 'boolean' },
    { key: 'apiVersion', label: 'API version (YYYYMM, optional)', type: 'text', help: 'Leave empty to use a recent version automatically.' }
  ],

  buildAuthorizeUrl({ settings, redirectUri, state }) {
    const scopes = ['openid', 'profile', 'w_member_social'];
    if (settings.options.companyPages) scopes.push('w_organization_social', 'r_organization_social', 'rw_organization_admin');
    const q = new URLSearchParams({ response_type: 'code', client_id: settings.clientId, redirect_uri: redirectUri, state, scope: scopes.join(' ') });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },

  async exchangeCode({ settings, redirectUri, code, fetchImpl }) {
    const r = await http(fetchImpl, 'LinkedIn sign-in', 'https://www.linkedin.com/oauth/v2/accessToken', {
      form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: settings.clientId, client_secret: settings.clientSecret }
    });
    return {
      accessToken: r.json.access_token,
      refreshToken: r.json.refresh_token,
      expiresAt: expiresFrom(r.json.expires_in),
      scopes: String(r.json.scope || '').split(/[ ,]/).filter(Boolean)
    };
  },

  async discoverAccounts({ settings, tokens, fetchImpl }) {
    const version = linkedinVersion(settings.options.apiVersion);
    const me = await http(fetchImpl, 'LinkedIn profile', `${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    const out: DiscoveredAccount[] = [
      {
        platform: 'linkedin',
        accountId: `urn:li:person:${me.json.sub}`,
        name: me.json.name || [me.json.given_name, me.json.family_name].filter(Boolean).join(' ') || 'LinkedIn member',
        avatarUrl: me.json.picture,
        accountType: 'person',
        ...tokens
      }
    ];
    if (settings.options.companyPages) {
      const acl = await http(
        fetchImpl,
        'LinkedIn pages',
        `${API}/rest/organizationAcls?q=roleAssignee&state=APPROVED`,
        { headers: restHeaders(tokens.accessToken, version), allowError: true }
      );
      const roles = ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'DIRECT_SPONSORED_CONTENT_POSTER'];
      const orgs = [...new Set<string>((acl.json?.elements || []).filter((e: any) => roles.includes(e.role)).map((e: any) => e.organization))];
      for (const urn of orgs.slice(0, 50)) {
        const id = urn.split(':').pop();
        const org = await http(fetchImpl, 'LinkedIn page', `${API}/rest/organizations/${id}`, { headers: restHeaders(tokens.accessToken, version), allowError: true });
        out.push({
          platform: 'linkedin',
          accountId: urn,
          name: org.json?.localizedName || `Company page ${id}`,
          username: org.json?.vanityName,
          accountType: 'organization',
          ...tokens
        });
      }
    }
    return out;
  },

  async refresh({ settings, account, fetchImpl }) {
    // Only apps approved for programmatic refresh get refresh tokens; others reconnect every 60 days.
    if (!account.refreshToken) return null;
    const r = await http(fetchImpl, 'LinkedIn sign-in refresh', 'https://www.linkedin.com/oauth/v2/accessToken', {
      form: { grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: settings.clientId, client_secret: settings.clientSecret }
    });
    return { accessToken: r.json.access_token, refreshToken: r.json.refresh_token || account.refreshToken, expiresAt: expiresFrom(r.json.expires_in) };
  },

  async publish(_platform, req) {
    const version = linkedinVersion(req.settings.options.apiVersion);
    const body: Record<string, any> = {
      author: req.account.accountId,
      commentary: escapeLittleText(req.text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    };
    const videos = req.media.filter((m) => m.kind === 'video');
    const images = req.media.filter((m) => m.kind === 'image');
    if (videos.length) {
      body.content = { media: { id: await uploadVideo(req, videos[0], version), title: req.options.title || undefined } };
    } else if (images.length === 1) {
      body.content = { media: { id: await uploadImage(req, images[0], version) } };
    } else if (images.length > 1) {
      const ids: string[] = [];
      for (const img of images) ids.push(await uploadImage(req, img, version));
      body.content = { multiImage: { images: ids.map((id) => ({ id })) } };
    }
    const r = await http(req.fetchImpl, 'LinkedIn', `${API}/rest/posts`, { headers: restHeaders(req.account.accessToken, version), json: body });
    const id = r.header('x-restli-id') || r.json?.id;
    if (!id) throw new PublishError('LinkedIn accepted the post but returned no id');
    return { remoteId: id, url: `https://www.linkedin.com/feed/update/${id}` };
  }
};

/**
 * LinkedIn "little text" reserves some characters; escape them so captions appear as written, and turn
 * #hashtags into LinkedIn's clickable hashtag form.
 */
export function escapeLittleText(text: string): string {
  const escape = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu)) {
    const start = (m.index || 0) + m[1].length;
    out += escape(text.slice(last, start)) + `{hashtag|\\#|${m[2]}}`;
    last = start + 1 + m[2].length;
  }
  return out + escape(text.slice(last));
}
