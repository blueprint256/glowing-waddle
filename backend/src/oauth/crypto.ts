import crypto from 'crypto';

/**
 * Small, dependency-free helpers for the OAuth server (unit-tested in scripts/mcpSelfTest.ts).
 */

export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly description: string,
    public readonly status: number = 400
  ) {
    super(description);
    this.name = 'OAuthError';
  }

  toJSON() {
    return { error: this.error, error_description: this.description };
  }
}

/** URL-safe random token with a readable prefix, e.g. "bpat_3q2…". */
export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && PKCE_CHALLENGE.test(challenge);
}

/** RFC 7636 S256: BASE64URL(SHA256(ascii(code_verifier))) === code_challenge */
export function verifyPkceS256(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !PKCE_VERIFIER.test(verifier)) return false;
  const computed = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return timingSafeEqualStr(computed, challenge);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Redirect URIs we accept at registration: https anywhere, or http on a loopback host
 * (native/CLI clients such as Claude Code). No fragments, no credentials.
 */
export function isAcceptableRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return true;
  return false;
}

/**
 * Exact string match against a registered redirect URI, except loopback http URIs where the
 * port may differ (RFC 8252 §7.3), and localhost / 127.0.0.1 are treated alike.
 */
export function matchRedirectUri(registered: string[], requested: string): string | null {
  if (registered.includes(requested)) return requested;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return null;
  }
  if (req.protocol !== 'http:' || !isLoopbackHost(req.hostname)) return null;
  for (const candidate of registered) {
    let reg: URL;
    try {
      reg = new URL(candidate);
    } catch {
      continue;
    }
    if (
      reg.protocol === 'http:' &&
      isLoopbackHost(reg.hostname) &&
      reg.pathname === req.pathname &&
      reg.search === req.search
    ) {
      return requested;
    }
  }
  return null;
}

/** Append query parameters to a redirect URI, keeping any it already has. */
export function buildRedirect(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return url.toString();
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * RFC 8707 resource indicator check. Accepts the MCP endpoint itself or the server root
 * (some clients send the origin), ignoring trailing slashes and host case.
 */
export function resourceMatches(requested: string, expectedMcpUrl: string): boolean {
  const req = normalizeUrl(requested);
  const expected = normalizeUrl(expectedMcpUrl);
  if (!req || !expected) return false;
  if (req === expected) return true;
  const expectedOrigin = normalizeUrl(new URL(expectedMcpUrl).origin);
  return req === expectedOrigin;
}

/** Parse "Basic base64(client_id:client_secret)" (values are form-urlencoded per RFC 6749 §2.3.1). */
export function parseBasicAuth(header: string | undefined): { clientId: string; clientSecret: string } | null {
  if (!header || !/^Basic\s+/i.test(header)) return null;
  try {
    const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, idx)),
      clientSecret: decodeURIComponent(decoded.slice(idx + 1))
    };
  } catch {
    return null;
  }
}

/** Extract a bearer token from an Authorization header. */
export function getBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)\s*$/i.exec(header);
  return match ? match[1] : null;
}
