import { Request } from 'express';

/**
 * Public URLs used by the OAuth server and the MCP connector.
 *
 * Claude reaches the connector from Anthropic's cloud, so these must be the address the
 * outside world uses (e.g. https://blueprint.example.com or a tunnel such as
 * https://abc123.trycloudflare.com). Set MCP_PUBLIC_URL in production and while tunnelling;
 * without it we fall back to the request's own protocol/host (correct behind a tunnel when
 * `trust proxy` is enabled, see server.ts).
 */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getPublicBaseUrl(req?: Request): string {
  const configured = process.env.MCP_PUBLIC_URL?.trim();
  if (configured) return stripTrailingSlash(configured);
  if (req) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${process.env.PORT || 5000}`;
}

/** True when MCP_PUBLIC_URL is configured (the UI uses this to show setup hints). */
export function hasConfiguredPublicUrl(): boolean {
  return Boolean(process.env.MCP_PUBLIC_URL?.trim());
}

export function getMcpResourceUrl(req?: Request): string {
  return `${getPublicBaseUrl(req)}/mcp`;
}

export function getFrontendUrl(): string {
  return stripTrailingSlash(process.env.FRONTEND_URL || 'http://localhost:3000');
}
