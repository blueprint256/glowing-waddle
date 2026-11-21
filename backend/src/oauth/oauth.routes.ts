import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { getPublicBaseUrl, getMcpResourceUrl, getFrontendUrl } from '../config/publicUrl';
import { OAuthError, buildRedirect, parseBasicAuth } from './crypto';
import {
  MCP_SCOPE,
  AuthorizeError,
  registerClient,
  findClient,
  authenticateClient,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken
} from './oauthService';

/**
 * OAuth 2.1 authorization server for the MCP connector (public, mounted at the server root):
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728
 *   GET  /.well-known/oauth-authorization-server         RFC 8414
 *   POST /oauth/register                                RFC 7591 (Dynamic Client Registration)
 *   GET  /oauth/authorize                               → consent screen in the web app
 *   POST /oauth/token                                   authorization_code (+PKCE S256) / refresh_token
 *   POST /oauth/revoke                                  RFC 7009
 *
 * Users sign in and approve inside the normal web app (any login method works, Google included);
 * see connectedApps.routes.ts for the consent API.
 */
const router = express.Router();

// These endpoints are called by other servers and by browser-based tools: open CORS, no cookies.
router.use(['/.well-known', '/oauth'], cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], maxAge: 86400 }));
router.use('/oauth', express.json({ limit: '50kb' }), express.urlencoded({ extended: false, limit: '50kb' }));

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.OAUTH_RATE_LIMIT_PER_15_MIN) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) => {
    res.status(429).json({ error: 'temporarily_unavailable', error_description: 'Too many requests, try again later' });
  }
});
router.use('/oauth', oauthLimiter);

function protectedResourceMetadata(req: Request) {
  return {
    resource: getMcpResourceUrl(req),
    authorization_servers: [getPublicBaseUrl(req)],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Blueprint'
  };
}

router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
  res.set('Cache-Control', 'public, max-age=300').json(protectedResourceMetadata(req));
});

router.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'], (req, res) => {
  const base = getPublicBaseUrl(req);
  res.set('Cache-Control', 'public, max-age=300').json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [MCP_SCOPE],
    authorization_response_iss_parameter_supported: true
  });
});

function sendOAuthError(res: Response, error: unknown) {
  if (error instanceof OAuthError) {
    if (error.status === 401) res.set('WWW-Authenticate', 'Basic realm="oauth"');
    res.status(error.status).set('Cache-Control', 'no-store').json(error.toJSON());
    return;
  }
  console.error('[oauth] Unexpected error:', error);
  res.status(500).set('Cache-Control', 'no-store').json({ error: 'server_error', error_description: 'Internal server error' });
}

router.post('/oauth/register', async (req: Request, res: Response) => {
  try {
    const registration = await registerClient(req.body);
    res.status(201).set('Cache-Control', 'no-store').json(registration);
  } catch (error) {
    sendOAuthError(res, error);
  }
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function errorPage(res: Response, status: number, message: string) {
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Connection error</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1f2328}` +
        `h1{font-size:20px}p{color:#57606a;line-height:1.5}</style></head><body><h1>We couldn't connect this app</h1>` +
        `<p>${escapeHtml(message)}</p></body></html>`
    );
}

router.get('/oauth/authorize', async (req: Request, res: Response) => {
  const q = req.query as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  try {
    const { requestId } = await createAuthorizationRequest(
      {
        response_type: str(q.response_type),
        client_id: str(q.client_id),
        redirect_uri: str(q.redirect_uri),
        state: str(q.state),
        scope: str(q.scope),
        code_challenge: str(q.code_challenge),
        code_challenge_method: str(q.code_challenge_method),
        resource: str(q.resource)
      },
      getMcpResourceUrl(req),
      getPublicBaseUrl(req)
    );
    res.redirect(302, `${getFrontendUrl()}/oauth/consent?request_id=${encodeURIComponent(requestId)}`);
  } catch (error) {
    if (error instanceof AuthorizeError && error.redirectUri) {
      res.redirect(
        302,
        buildRedirect(error.redirectUri, {
          error: error.error,
          error_description: error.description,
          state: error.state,
          iss: getPublicBaseUrl(req)
        })
      );
      return;
    }
    if (error instanceof OAuthError) {
      errorPage(res, 400, error.description);
      return;
    }
    console.error('[oauth] authorize failed:', error);
    errorPage(res, 500, 'Something went wrong on our side. Please try again.');
  }
});

/** Client credentials from Basic auth or the form body. */
async function loadClient(req: Request) {
  const basic = parseBasicAuth(req.headers.authorization);
  const clientId = basic?.clientId ?? req.body?.client_id;
  const clientSecret = basic?.clientSecret ?? (typeof req.body?.client_secret === 'string' ? req.body.client_secret : undefined);
  const client = await findClient(clientId);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);
  authenticateClient(client, clientSecret);
  return client;
}

router.post('/oauth/token', async (req: Request, res: Response) => {
  try {
    const client = await loadClient(req);
    const grantType = req.body?.grant_type;
    let tokens;
    if (grantType === 'authorization_code') {
      tokens = await exchangeAuthorizationCode(client, req.body, getMcpResourceUrl(req));
    } else if (grantType === 'refresh_token') {
      if (!client.grantTypes.includes('refresh_token')) {
        throw new OAuthError('unauthorized_client', 'This client may not use refresh tokens');
      }
      tokens = await refreshAccessToken(client, req.body, getMcpResourceUrl(req));
    } else {
      throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
    }
    res.status(200).set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).json(tokens);
  } catch (error) {
    sendOAuthError(res, error);
  }
});

router.post('/oauth/revoke', async (req: Request, res: Response) => {
  try {
    const client = await loadClient(req);
    await revokeToken(client, req.body?.token);
    res.status(200).set('Cache-Control', 'no-store').json({});
  } catch (error) {
    sendOAuthError(res, error);
  }
});

// Malformed bodies on the OAuth endpoints → OAuth-style JSON errors.
router.use('/oauth', (err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(400).json({ error: 'invalid_request', error_description: 'Malformed request body' });
    return;
  }
  next(err);
});

export default router;
