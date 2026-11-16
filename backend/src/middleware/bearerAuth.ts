import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { getBearerToken, timingSafeEqualStr } from '../oauth/crypto';
import { validateAccessToken } from '../oauth/oauthService';
import { getPublicBaseUrl } from '../config/publicUrl';

declare global {
  namespace Express {
    interface Request {
      /** Set when the request was authenticated with an OAuth access token (e.g. from Claude). */
      oauth?: { clientId: string; tokenId: string };
    }
  }
}

/**
 * OAuth access tokens (issued to Claude through the MCP connector) authenticate API requests as the
 * user who approved the connection, with exactly the same permissions as that user in the web app:
 * every route keeps running its own role, ownership and Part one / Part two checks.
 *
 * Requests carrying a bearer token never touch the cookie session.
 */

/** Per-process secret that marks the connector's own loopback calls (exempt from the per-IP limiter). */
const INTERNAL_SECRET = crypto.randomBytes(32).toString('base64url');
export const INTERNAL_HEADER = 'x-blueprint-internal';

export function getInternalSecret(): string {
  return INTERNAL_SECRET;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function isInternalRequest(req: Request): boolean {
  const header = req.headers[INTERNAL_HEADER];
  return (
    typeof header === 'string' &&
    timingSafeEqualStr(header, INTERNAL_SECRET) &&
    isLoopbackAddress(req.socket.remoteAddress)
  );
}

export function hasBearerToken(req: Request): boolean {
  return /^Bearer\s/i.test(req.headers.authorization || '');
}

/** Wrap session middleware so it is skipped for bearer-token requests. */
export function skipForBearer(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => (hasBearerToken(req) ? next() : middleware(req, res, next));
}

/**
 * Endpoints a token may not use: signing in/out, approving further OAuth connections and
 * managing connected apps are only possible from the web app itself.
 */
function isBlockedForTokens(req: Request): boolean {
  const path = `${req.baseUrl}${req.path}`.toLowerCase();
  if (path.startsWith('/api/auth/')) {
    return !(req.method === 'GET' && (path === '/api/auth/me' || path === '/api/auth/check'));
  }
  return path.startsWith('/api/oauth/') || path.startsWith('/api/connected-apps');
}

export function wwwAuthenticate(req: Request, error?: string, description?: string): string {
  const parts = [`resource_metadata="${getPublicBaseUrl(req)}/.well-known/oauth-protected-resource"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(', ')}`;
}

/** Mounted on /api after the session middleware. No-op for cookie-authenticated requests. */
export const authenticateBearer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!hasBearerToken(req)) return next();

  const raw = getBearerToken(req.headers.authorization);
  if (!raw) {
    res.status(401).set('WWW-Authenticate', wwwAuthenticate(req, 'invalid_token', 'Malformed bearer token'))
      .json({ success: false, message: 'Malformed bearer token' });
    return;
  }

  if (isBlockedForTokens(req)) {
    res.status(403).json({ success: false, message: 'This endpoint is only available from the web app' });
    return;
  }

  try {
    const check = await validateAccessToken(raw);
    if (!check.ok) {
      const status = check.reason === 'connector_disabled' ? 403 : 401;
      if (status === 401) res.set('WWW-Authenticate', wwwAuthenticate(req, 'invalid_token', check.message));
      res.status(status).json({ success: false, code: check.reason.toUpperCase(), message: check.message });
      return;
    }
    req.user = check.user;
    req.oauth = { clientId: check.token.clientId, tokenId: String(check.token._id) };
    next();
  } catch (error) {
    next(error);
  }
};
