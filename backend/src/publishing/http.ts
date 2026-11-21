import { FetchLike, PublishError } from './types';

/** Small HTTP helper for platform APIs: timeouts, JSON parsing and error classification. */

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  /** Return the raw response even when not ok (caller inspects). */
  allowError?: boolean;
}

export interface HttpResult {
  status: number;
  ok: boolean;
  json: any;
  text: string;
  header(name: string): string | null;
}

export async function http(fetchImpl: FetchLike, label: string, url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res;
  try {
    res = await fetchImpl(url, { method: opts.method || (body !== undefined ? 'POST' : 'GET'), headers, body, signal: controller.signal });
  } catch (error: any) {
    throw new PublishError(error?.name === 'AbortError' ? `${label} took too long to respond` : `Could not reach ${label}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  const result: HttpResult = { status: res.status, ok: res.ok, json, text, header: (n) => res.headers.get(n) };
  if (!res.ok && !opts.allowError) throw classify(label, res.status, json, text);
  return result;
}

/** Turns a platform error into a PublishError the scheduler understands. */
export function classify(label: string, status: number, json: any, text = ''): PublishError {
  const detail =
    json?.error?.message ||
    json?.error_description ||
    json?.detail ||
    json?.message ||
    json?.errors?.[0]?.message ||
    json?.error?.code ||
    (typeof json?.error === 'string' ? json.error : '') ||
    text.slice(0, 300) ||
    `HTTP ${status}`;
  const message = `${label}: ${detail}`;
  // Meta reports expired/revoked tokens as code 190.
  const reconnect = status === 401 || json?.error?.code === 190 || json?.error?.code === 'access_token_invalid';
  const retryable = status === 429 || status >= 500;
  return new PublishError(message, { status, reconnect, retryable });
}

export function expiresFrom(seconds: unknown): Date | null {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(Date.now() + n * 1000) : null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
