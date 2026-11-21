import http from 'http';

/**
 * The connector talks to the app through its own REST API (over loopback), authenticated with
 * the user's OAuth access token. That guarantees Claude gets exactly the same validation,
 * role/ownership checks, Part one / Part two rules and audit logging as the web app.
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryValue = string | number | boolean | string[] | undefined | null;

export interface ApiRequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
}

export interface ApiClient {
  request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, options?: ApiRequestOptions): Promise<T>;
}

export interface ApiClientConfig {
  baseUrl: string; // e.g. http://127.0.0.1:5000
  /** OAuth access token (Claude connector). */
  accessToken?: string;
  /** In-app assistant (Blue): act as this user id via the internal loopback header. */
  actAsUserId?: string;
  actAsHeader?: string;
  internalHeader: string;
  internalSecret: string;
  userAgent: string;
}

/** Turn an API error body into one readable sentence for Claude. */
export function formatApiError(status: number, body: any): string {
  let message = typeof body?.message === 'string' && body.message ? body.message : `Request failed with HTTP ${status}`;
  if (Array.isArray(body?.errors) && body.errors.length) {
    const details = body.errors
      .map((e: any) => [e.path || e.param, e.msg || e.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
    if (details) message += ` (${details})`;
  }
  if (typeof body?.code === 'string') message += ` [${body.code}]`;
  return message;
}

export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return {
    request(method, path, options = {}) {
      const url = new URL(`${config.baseUrl}${path}${buildQuery(options.query)}`);
      const payload = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));

      return new Promise((resolve, reject) => {
        const req = http.request(
          url,
          {
            method,
            headers: {
              Accept: 'application/json',
              ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
              ...(config.actAsUserId ? { [config.actAsHeader || 'x-blueprint-act-as']: config.actAsUserId } : {}),
              'User-Agent': config.userAgent,
              [config.internalHeader]: config.internalSecret,
              ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {})
            }
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let body: any = undefined;
              try {
                body = text ? JSON.parse(text) : undefined;
              } catch {
                body = { message: text.slice(0, 500) };
              }
              const status = res.statusCode || 500;
              if (status >= 400 || body?.success === false) {
                reject(new ApiError(status, formatApiError(status, body), body));
              } else {
                resolve(body);
              }
            });
          }
        );
        req.setTimeout(options.timeoutMs ?? 30000, () => {
          req.destroy(new ApiError(504, 'The app took too long to respond'));
        });
        req.on('error', (err) => reject(err instanceof ApiError ? err : new ApiError(502, `Could not reach the app API: ${err.message}`)));
        if (payload) req.write(payload);
        req.end();
      });
    }
  };
}
