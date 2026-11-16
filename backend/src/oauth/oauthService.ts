import mongoose from 'mongoose';
import { OAuthClient, IOAuthClient } from '../models/OAuthClient';
import { OAuthAuthorization } from '../models/OAuthAuthorization';
import { OAuthToken, IOAuthToken } from '../models/OAuthToken';
import { User, IUser, canUseConnector } from '../models/User';
import {
  OAuthError,
  randomToken,
  sha256,
  timingSafeEqualStr,
  verifyPkceS256,
  isValidCodeChallenge,
  isAcceptableRedirectUri,
  matchRedirectUri,
  buildRedirect,
  resourceMatches
} from './crypto';

/** The single scope we issue: full access to the user's account, same as the web app. */
export const MCP_SCOPE = 'mcp';

const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.MCP_ACCESS_TOKEN_TTL_SECONDS) || 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.MCP_REFRESH_TOKEN_TTL_SECONDS) || 60 * 60 * 24 * 30; // 30 days
const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000; // user has 10 minutes to approve
const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // client has 5 minutes to redeem the code
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

export const CONNECTOR_DISABLED_MESSAGE =
  'Claude connector access is turned off for this account. Ask your administrator to enable it.';

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

export async function registerClient(body: any): Promise<Record<string, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new OAuthError('invalid_client_metadata', 'Request body must be a JSON object');
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array (max 10)');
  }
  for (const uri of redirectUris) {
    if (!isAcceptableRedirectUri(uri)) {
      throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${String(uri)}`);
    }
  }

  const authMethod = body.token_endpoint_auth_method ?? 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) {
    throw new OAuthError('invalid_client_metadata', `Unsupported token_endpoint_auth_method: ${authMethod}`);
  }

  const requestedGrants: string[] = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'];
  if (!requestedGrants.includes('authorization_code')) {
    throw new OAuthError('invalid_client_metadata', 'grant_types must include authorization_code');
  }
  const grantTypes = requestedGrants.filter((g) => g === 'authorization_code' || g === 'refresh_token');

  const responseTypes: string[] = Array.isArray(body.response_types) ? body.response_types : ['code'];
  if (!responseTypes.includes('code')) {
    throw new OAuthError('invalid_client_metadata', 'response_types must include code');
  }

  const clientName =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 120)
      : 'AI assistant';

  const clientId = randomToken('bpc_', 18);
  let clientSecret: string | undefined;
  if (authMethod !== 'none') clientSecret = randomToken('bpcs_', 32);

  const client = await OAuthClient.create({
    clientId,
    clientSecretHash: clientSecret ? sha256(clientSecret) : undefined,
    clientName,
    clientUri: typeof body.client_uri === 'string' ? body.client_uri.slice(0, 500) : undefined,
    redirectUris,
    grantTypes,
    responseTypes: ['code'],
    tokenEndpointAuthMethod: authMethod,
    scope: MCP_SCOPE
  });

  return {
    client_id: client.clientId,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    ...(client.clientUri ? { client_uri: client.clientUri } : {}),
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    scope: client.scope
  };
}

export async function findClient(clientId: unknown): Promise<IOAuthClient | null> {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 200) return null;
  return OAuthClient.findOne({ clientId });
}

/** Verify client credentials at the token/revocation endpoints. Public clients need none. */
export function authenticateClient(client: IOAuthClient, clientSecret: string | undefined): void {
  if (client.tokenEndpointAuthMethod === 'none') return;
  if (!clientSecret || !client.clientSecretHash || !timingSafeEqualStr(sha256(clientSecret), client.clientSecretHash)) {
    throw new OAuthError('invalid_client', 'Client authentication failed', 401);
  }
}

// ---------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
}

/**
 * Errors we must NOT redirect for (unknown client / bad redirect URI) are thrown as OAuthError
 * with `redirectable=false`; everything else is reported back to the client's redirect URI.
 */
export class AuthorizeError extends OAuthError {
  constructor(error: string, description: string, public readonly redirectUri?: string, public readonly state?: string) {
    super(error, description, 400);
  }
}

export async function createAuthorizationRequest(params: AuthorizeParams, expectedMcpUrl: string, issuer: string) {
  const client = await findClient(params.client_id);
  if (!client) {
    throw new AuthorizeError('invalid_client', 'Unknown client_id. Remove the connector in Claude and add it again.');
  }

  let redirectUri: string | null;
  if (params.redirect_uri) {
    redirectUri = matchRedirectUri(client.redirectUris, params.redirect_uri);
  } else {
    redirectUri = client.redirectUris.length === 1 ? client.redirectUris[0] : null;
  }
  if (!redirectUri) {
    throw new AuthorizeError('invalid_request', 'redirect_uri does not match the registered redirect URIs');
  }

  // From here on, errors go back to the client.
  const fail = (error: string, description: string) => new AuthorizeError(error, description, redirectUri!, params.state);

  if (params.response_type !== 'code') throw fail('unsupported_response_type', 'response_type must be "code"');
  if (!isValidCodeChallenge(params.code_challenge)) throw fail('invalid_request', 'A valid PKCE code_challenge is required');
  if (params.code_challenge_method !== 'S256') throw fail('invalid_request', 'code_challenge_method must be S256');
  if (params.resource && !resourceMatches(params.resource, expectedMcpUrl)) {
    throw fail('invalid_target', `Unknown resource ${params.resource}`);
  }

  const auth = await OAuthAuthorization.create({
    requestId: randomToken('bpar_', 24),
    issuer,
    clientId: client.clientId,
    redirectUri,
    state: typeof params.state === 'string' ? params.state.slice(0, 1024) : undefined,
    scope: MCP_SCOPE,
    resource: params.resource,
    codeChallenge: params.code_challenge,
    codeChallengeMethod: 'S256',
    status: 'pending',
    expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS)
  });

  return { requestId: auth.requestId };
}

async function loadPendingRequest(requestId: unknown) {
  if (typeof requestId !== 'string' || !requestId) {
    throw new OAuthError('invalid_request', 'Missing authorization request', 404);
  }
  const auth = await OAuthAuthorization.findOne({ requestId });
  if (!auth || auth.expiresAt.getTime() < Date.now()) {
    throw new OAuthError('invalid_request', 'This authorization request has expired. Start the connection again from Claude.', 404);
  }
  return auth;
}

/** Details shown on the consent screen. */
export async function describeAuthorizationRequest(requestId: unknown, user: IUser) {
  const auth = await loadPendingRequest(requestId);
  const client = await findClient(auth.clientId);
  return {
    requestId: auth.requestId,
    status: auth.status,
    clientName: client?.clientName || 'AI assistant',
    redirectHost: new URL(auth.redirectUri).host,
    scope: auth.scope,
    connectorAllowed: canUseConnector(user),
    user: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      accessMode: user.accessMode
    }
  };
}

/** Record the user's decision and return where the browser should go next. */
export async function decideAuthorizationRequest(requestId: unknown, user: IUser, approve: boolean) {
  const auth = await loadPendingRequest(requestId);
  if (auth.status !== 'pending') {
    throw new OAuthError('invalid_request', 'This authorization request was already answered. Start the connection again from Claude.', 409);
  }

  if (!approve || !canUseConnector(user)) {
    auth.status = 'denied';
    auth.userId = user._id as mongoose.Types.ObjectId;
    await auth.save();
    return {
      redirectUrl: buildRedirect(auth.redirectUri, {
        error: 'access_denied',
        error_description: approve ? CONNECTOR_DISABLED_MESSAGE : 'The user declined the connection',
        state: auth.state,
        iss: auth.issuer
      })
    };
  }

  const code = randomToken('bpac_', 32);
  auth.status = 'approved';
  auth.userId = user._id as mongoose.Types.ObjectId;
  auth.codeHash = sha256(code);
  auth.expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS);
  await auth.save();

  return {
    redirectUrl: buildRedirect(auth.redirectUri, { code, state: auth.state, iss: auth.issuer })
  };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

async function loadConnectorUser(userId: mongoose.Types.ObjectId): Promise<IUser> {
  const user = await User.findById(userId).select('-password');
  if (!user || !user.isActive) throw new OAuthError('invalid_grant', 'The account is no longer active');
  if (!canUseConnector(user)) throw new OAuthError('invalid_grant', CONNECTOR_DISABLED_MESSAGE);
  return user;
}

async function issueTokens(
  clientId: string,
  userId: mongoose.Types.ObjectId,
  scope: string,
  resource: string | undefined,
  grantedAt: Date
): Promise<TokenResponse> {
  const accessToken = randomToken('bpat_', 32);
  const refreshToken = randomToken('bprt_', 32);
  const now = Date.now();
  await OAuthToken.create({
    accessTokenHash: sha256(accessToken),
    refreshTokenHash: sha256(refreshToken),
    clientId,
    userId,
    scope,
    resource,
    grantedAt,
    accessTokenExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
    refreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000)
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope
  };
}

export async function exchangeAuthorizationCode(
  client: IOAuthClient,
  params: { code?: unknown; redirect_uri?: unknown; code_verifier?: unknown; resource?: unknown },
  expectedMcpUrl: string
): Promise<TokenResponse> {
  if (typeof params.code !== 'string' || !params.code) throw new OAuthError('invalid_request', 'code is required');
  if (typeof params.code_verifier !== 'string') throw new OAuthError('invalid_request', 'code_verifier is required');

  // Atomically consume the code so it can only be redeemed once.
  const auth = await OAuthAuthorization.findOneAndUpdate(
    { codeHash: sha256(params.code), status: 'approved' },
    { $set: { status: 'used' } },
    { new: false }
  );
  if (!auth || auth.expiresAt.getTime() < Date.now()) {
    throw new OAuthError('invalid_grant', 'Authorization code is invalid, expired or already used');
  }
  if (auth.clientId !== client.clientId) throw new OAuthError('invalid_grant', 'Authorization code was issued to another client');
  if (typeof params.redirect_uri === 'string' && params.redirect_uri !== auth.redirectUri) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
  }
  if (!verifyPkceS256(params.code_verifier, auth.codeChallenge)) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed');
  }
  if (typeof params.resource === 'string' && params.resource && !resourceMatches(params.resource, expectedMcpUrl)) {
    throw new OAuthError('invalid_target', `Unknown resource ${params.resource}`);
  }
  if (!auth.userId) throw new OAuthError('invalid_grant', 'Authorization code has no user');

  await loadConnectorUser(auth.userId);
  const resource = (typeof params.resource === 'string' && params.resource) || auth.resource;
  return issueTokens(client.clientId, auth.userId, auth.scope, resource, new Date());
}

export async function refreshAccessToken(
  client: IOAuthClient,
  params: { refresh_token?: unknown; resource?: unknown },
  expectedMcpUrl: string
): Promise<TokenResponse> {
  if (typeof params.refresh_token !== 'string' || !params.refresh_token) {
    throw new OAuthError('invalid_request', 'refresh_token is required');
  }
  if (typeof params.resource === 'string' && params.resource && !resourceMatches(params.resource, expectedMcpUrl)) {
    throw new OAuthError('invalid_target', `Unknown resource ${params.resource}`);
  }

  // Rotate: atomically retire the presented refresh token (it can never be used again), then issue a
  // fresh pair. The previous access token keeps working until it expires so in-flight requests don't fail;
  // its record is cleaned up by the TTL index once that access token can no longer be used.
  const previous = await OAuthToken.findOneAndUpdate(
    {
      refreshTokenHash: sha256(params.refresh_token),
      clientId: client.clientId,
      revokedAt: { $exists: false },
      refreshTokenExpiresAt: { $gt: new Date() }
    },
    {
      $unset: { refreshTokenHash: 1 },
      $set: { refreshTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000) }
    },
    { new: false }
  );
  if (!previous) throw new OAuthError('invalid_grant', 'Refresh token is invalid, expired or revoked');

  await loadConnectorUser(previous.userId);
  return issueTokens(client.clientId, previous.userId, previous.scope, previous.resource, previous.grantedAt || previous.createdAt);
}

/** RFC 7009: revoke an access or refresh token. Unknown tokens are not an error. */
export async function revokeToken(client: IOAuthClient, token: unknown): Promise<void> {
  if (typeof token !== 'string' || !token) return;
  const hash = sha256(token);
  await OAuthToken.updateMany(
    { clientId: client.clientId, $or: [{ accessTokenHash: hash }, { refreshTokenHash: hash }], revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } }
  );
}

// ---------------------------------------------------------------------------
// Resource server side
// ---------------------------------------------------------------------------

export type AccessTokenCheck =
  | { ok: true; token: IOAuthToken; user: IUser }
  | { ok: false; reason: 'invalid_token' | 'connector_disabled'; message: string };

export async function validateAccessToken(rawToken: string): Promise<AccessTokenCheck> {
  const token = await OAuthToken.findOne({ accessTokenHash: sha256(rawToken) });
  if (!token || token.revokedAt || token.accessTokenExpiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'invalid_token', message: 'The access token is invalid or has expired' };
  }

  const user = await User.findById(token.userId).select('-password');
  if (!user || !user.isActive) {
    return { ok: false, reason: 'invalid_token', message: 'The account is no longer active' };
  }
  if (!canUseConnector(user)) {
    return { ok: false, reason: 'connector_disabled', message: CONNECTOR_DISABLED_MESSAGE };
  }

  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    // Fire-and-forget; failure to record usage must never block a request.
    OAuthToken.updateOne({ _id: token._id }, { $set: { lastUsedAt: new Date() } }).catch(() => undefined);
  }

  return { ok: true, token, user };
}

// ---------------------------------------------------------------------------
// Connected apps (user-facing management)
// ---------------------------------------------------------------------------

export async function listConnections(userId: mongoose.Types.ObjectId) {
  const tokens = await OAuthToken.find({
    userId,
    revokedAt: { $exists: false },
    refreshTokenExpiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });

  const byClient = new Map<string, { connectedAt: Date; lastUsedAt?: Date }>();
  for (const t of tokens) {
    const entry = byClient.get(t.clientId);
    const lastUsed = t.lastUsedAt || t.createdAt;
    const granted = t.grantedAt || t.createdAt;
    if (!entry) {
      byClient.set(t.clientId, { connectedAt: granted, lastUsedAt: lastUsed });
    } else {
      if (granted < entry.connectedAt) entry.connectedAt = granted;
      if (!entry.lastUsedAt || lastUsed > entry.lastUsedAt) entry.lastUsedAt = lastUsed;
    }
  }

  const clients = await OAuthClient.find({ clientId: { $in: [...byClient.keys()] } });
  const names = new Map(clients.map((c) => [c.clientId, c.clientName]));

  return [...byClient.entries()].map(([clientId, info]) => ({
    clientId,
    clientName: names.get(clientId) || 'AI assistant',
    connectedAt: info.connectedAt,
    lastUsedAt: info.lastUsedAt
  }));
}

/** Revoke every live token for a user (optionally only for one client). Returns how many were revoked. */
export async function revokeUserTokens(userId: mongoose.Types.ObjectId | string, clientId?: string): Promise<number> {
  const result = await OAuthToken.updateMany(
    { userId, ...(clientId ? { clientId } : {}), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } }
  );
  return result.modifiedCount;
}
