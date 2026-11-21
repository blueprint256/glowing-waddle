import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { getBearerToken, timingSafeEqualStr } from '../oauth/crypto';
import { validateAccessToken } from '../oauth/oauthService';
import mongoose from 'mongoose';
import { User, canUseBlue } from '../models/User';
import { getPublicBaseUrl } from '../config/publicUrl';

declare global {
  namespace Express {
    interface Request {
      /** Set when the request was authenticated with an OAuth access token (e.g. from Claude). */
      oauth?: { clientId: string; tokenId: string };
      /** Set when the request was made by Blue (the in-app assistant) on the user's behalf. */
      viaBlue?: boolean;
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
/** Loopback-only header Blue uses to act as the signed-in user (honoured only with the internal secret). */
export const ACT_AS_HEADER = 'x-blueprint-act-as';

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

function isActAsRequest(req: Request): boolean {
  return typeof req.headers[ACT_AS_HEADER] === 'string' && isInternalRequest(req);
}

/** Wrap session middleware so it is skipped for bearer-token and Blue act-as requests. */
export function skipForBearer(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => (hasBearerToken(req) || isActAsRequest(req) ? next() : middleware(req, res, next));
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
  return path.startsWith('/api/oauth/') || path.startsWith('/api/connected-apps') || path.startsWith('/api/blue');
}

export function wwwAuthenticate(req: Request, error?: string, description?: string): string {
  const parts = [`resource_metadata="${getPublicBaseUrl(req)}/.well-known/oauth-protected-resource"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(', ')}`;
}

/** Mounted on /api after the session middleware. No-op for cookie-authenticated requests. */
export const authenticateBearer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!hasBearerToken(req)) {
    if (isActAsRequest(req)) return authenticateActAs(req, res, next);
    return next();
  }

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

/** Blue's own loopback calls: act as the signed-in user, with exactly their permissions. */
async function authenticateActAs(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isBlockedForTokens(req)) {
    res.status(403).json({ success: false, message: 'This endpoint is only available from the web app' });
    return;
  }
  try {
    const userId = req.headers[ACT_AS_HEADER] as string;
    const user = mongoose.isValidObjectId(userId) ? await User.findById(userId).select('-password') : null;
    if (!user || !user.isActive || !canUseBlue(user)) {
      res.status(403).json({ success: false, message: 'Blue is not available for this account' });
      return;
    }
    req.user = user;
    req.viaBlue = true;
    next();
  } catch (error) {
    next(error);
  }
}
