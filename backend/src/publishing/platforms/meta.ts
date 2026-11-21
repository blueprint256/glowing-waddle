import { ProviderAdapter, PublishError, PublishRequest, DiscoveredAccount, PlatformId } from '../types';
import { http, sleep } from '../http';

/**
 * Meta — one app covers Facebook Pages and Instagram professional accounts (Facebook Login for Business).
 * Posting for clients needs Business Verification + App Review for pages_manage_posts and
 * instagram_content_publish ("Advanced Access"). Before approval it works for accounts that have a role
 * on the app (your own pages and testers).
 * Docs: https://developers.facebook.com/docs/pages-api/posts · https://developers.facebook.com/docs/instagram-platform/content-publishing
 */

const SCOPES = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'business_management', 'instagram_basic', 'instagram_content_publish'];

function graph(settings: { options: Record<string, unknown> }): string {
  const v = typeof settings.options.graphVersion === 'string' && /^v\d+\.\d+$/.test(settings.options.graphVersion) ? settings.options.graphVersion : 'v24.0';
  return `https://graph.facebook.com/${v}`;
}

async function publishFacebook(req: PublishRequest) {
  const base = graph(req.settings);
  const token = req.account.accessToken;
  const pageId = req.account.accountId;
  const images = req.media.filter((m) => m.kind === 'image');
  const video = req.media.find((m) => m.kind === 'video');
  let id: string;
  if (video) {
    const r = await http(req.fetchImpl, 'Facebook', `${base}/${pageId}/videos`, {
      form: { file_url: await video.publicUrl(), description: req.text, access_token: token },
      timeoutMs: 180_000
    });
    id = r.json.id;
    return { remoteId: id, url: `https://www.facebook.com/${pageId}/videos/${id}` };
  }
  if (images.length === 1) {
    const r = await http(req.fetchImpl, 'Facebook', `${base}/${pageId}/photos`, {
      form: { url: await images[0].publicUrl(), caption: req.text, access_token: token }
    });
    id = r.json.post_id || r.json.id;
  } else if (images.length > 1) {
    const ids: string[] = [];
    for (const img of images) {
      const r = await http(req.fetchImpl, 'Facebook', `${base}/${pageId}/photos`, {
        form: { url: await img.publicUrl(), published: 'false', access_token: token }
      });
      ids.push(r.json.id);
    }
    const form: Record<string, string> = { message: req.text, access_token: token };
    ids.forEach((mid, i) => (form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: mid })));
    const r = await http(req.fetchImpl, 'Facebook', `${base}/${pageId}/feed`, { form });
    id = r.json.id;
  } else {
    const r = await http(req.fetchImpl, 'Facebook', `${base}/${pageId}/feed`, { form: { message: req.text, access_token: token } });
    id = r.json.id;
  }
  if (!id) throw new PublishError('Facebook accepted the post but returned no id');
  return { remoteId: id, url: `https://www.facebook.com/${id}` };
}

async function waitForContainer(req: PublishRequest, base: string, containerId: string) {
  for (let i = 0; i < 60; i++) {
    const r = await http(req.fetchImpl, 'Instagram', `${base}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(req.account.accessToken)}`);
    const status = r.json.status_code;
    if (status === 'FINISHED' || status === 'PUBLISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new PublishError(`Instagram could not process the media: ${r.json.status || status}`);
    await sleep(i < 5 ? 3000 : 6000);
    await req.heartbeat('Instagram is processing the media');
  }
  throw new PublishError('Instagram is taking too long to process the media', { retryable: true });
}

async function publishInstagram(req: PublishRequest) {
  const base = graph(req.settings);
  const token = req.account.accessToken;
  const igId = req.account.accountId;
  const create = async (fields: Record<string, string>) =>
    (await http(req.fetchImpl, 'Instagram', `${base}/${igId}/media`, { form: { ...fields, access_token: token }, timeoutMs: 120_000 })).json.id as string;
  const itemFields = async (m: PublishRequest['media'][number], carousel: boolean): Promise<Record<string, string>> =>
    m.kind === 'video'
      ? { media_type: carousel ? 'VIDEO' : 'REELS', video_url: await m.publicUrl() }
      : { image_url: await m.publicJpegUrl() };

  let containerId: string;
  if (req.media.length === 1) {
    containerId = await create({ ...(await itemFields(req.media[0], false)), caption: req.text });
  } else {
    const children: string[] = [];
    for (const m of req.media) {
      const child = await create({ ...(await itemFields(m, true)), is_carousel_item: 'true' });
      if (m.kind === 'video') await waitForContainer(req, base, child);
      children.push(child);
    }
    containerId = await create({ media_type: 'CAROUSEL', children: children.join(','), caption: req.text });
  }
  await waitForContainer(req, base, containerId);
  const pub = await http(req.fetchImpl, 'Instagram', `${base}/${igId}/media_publish`, { form: { creation_id: containerId, access_token: token } });
  const id: string = pub.json.id;
  if (!id) throw new PublishError('Instagram accepted the post but returned no id');
  const link = await http(req.fetchImpl, 'Instagram', `${base}/${id}?fields=permalink&access_token=${encodeURIComponent(token)}`, { allowError: true });
  return { remoteId: id, url: link.json?.permalink };
}

export const metaAdapter: ProviderAdapter = {
  id: 'meta',
  name: 'Meta (Facebook & Instagram)',
  platforms: ['facebook', 'instagram'],
  developerPortal: 'https://developers.facebook.com/apps',
  approvalNote:
    'Needs Meta Business Verification, then App Review for pages_manage_posts and instagram_content_publish. Before approval it works only for pages and Instagram accounts of people with a role on your Meta app.',
  optionFields: [{ key: 'graphVersion', label: 'Graph API version (optional, e.g. v24.0)', type: 'text' }],

  buildAuthorizeUrl({ settings, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: settings.clientId, redirect_uri: redirectUri, state, response_type: 'code', scope: SCOPES.join(',') });
    return `https://www.facebook.com/${graph(settings).split('/').pop()}/dialog/oauth?${q}`;
  },

  async exchangeCode({ settings, redirectUri, code, fetchImpl }) {
    const base = graph(settings);
    const short = await http(
      fetchImpl,
      'Meta sign-in',
      `${base}/oauth/access_token?${new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, redirect_uri: redirectUri, code })}`
    );
    // Long-lived user token → Page tokens that don't expire.
    const long = await http(
      fetchImpl,
      'Meta sign-in',
      `${base}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: settings.clientId, client_secret: settings.clientSecret, fb_exchange_token: short.json.access_token })}`
    );
    return { accessToken: long.json.access_token || short.json.access_token, expiresAt: null };
  },

  async discoverAccounts({ settings, tokens, fetchImpl }) {
    const base = graph(settings);
    const out: DiscoveredAccount[] = [];
    let url: string | undefined = `${base}/me/accounts?${new URLSearchParams({
      fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}',
      limit: '100',
      access_token: tokens.accessToken
    })}`;
    for (let page = 0; url && page < 5; page++) {
      const r = await http(fetchImpl, 'Facebook pages', url);
      for (const p of r.json.data || []) {
        out.push({
          platform: 'facebook',
          accountId: p.id,
          name: p.name,
          avatarUrl: p.picture?.data?.url,
          accountType: 'page',
          accessToken: p.access_token,
          expiresAt: null
        });
        const ig = p.instagram_business_account;
        if (ig?.id) {
          out.push({
            platform: 'instagram',
            accountId: ig.id,
            name: ig.name || ig.username || p.name,
            username: ig.username,
            avatarUrl: ig.profile_picture_url,
            accountType: 'business',
            accessToken: p.access_token,
            expiresAt: null,
            meta: { pageId: p.id }
          });
        }
      }
      url = r.json.paging?.next;
    }
    return out;
  },

  async publish(platform: PlatformId, req) {
    return platform === 'instagram' ? publishInstagram(req) : publishFacebook(req);
  }
};
