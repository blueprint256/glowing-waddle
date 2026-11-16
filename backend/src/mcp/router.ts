import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { getBearerToken } from '../oauth/crypto';
import { validateAccessToken } from '../oauth/oauthService';
import { canUseAI } from '../models/User';
import { getFrontendUrl } from '../config/publicUrl';
import { getInternalSecret, INTERNAL_HEADER, wwwAuthenticate } from '../middleware/bearerAuth';
import { createApiClient } from './apiClient';
import { handlePost, SUPPORTED_PROTOCOL_VERSIONS, JSONRPC } from './protocol';
import { TOOLS, SERVER_INSTRUCTIONS, ToolContext } from './tools';
import { OAuthClient } from '../models/OAuthClient';

/**
 * MCP endpoint (Streamable HTTP transport, stateless): POST /mcp
 * Authenticated with OAuth 2.1 bearer tokens issued by our own authorization server (oauth.routes.ts).
 */
const router = express.Router();

const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Browser-based MCP clients (e.g. the MCP Inspector) need CORS; Claude itself calls server-to-server.
router.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Mcp-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
    exposedHeaders: ['WWW-Authenticate', 'Mcp-Protocol-Version'],
    maxAge: 86400
  })
);

// DNS-rebinding protection (MCP spec): when MCP_ALLOWED_ORIGINS is set, refuse other browser origins.
router.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    res.status(403).json({ jsonrpc: '2.0', id: null, error: { code: JSONRPC.INVALID_REQUEST, message: 'Origin not allowed' } });
    return;
  }
  next();
});

router.use(express.json({ limit: '2mb' }));

// Per-token limit (the loopback API calls it makes are not counted against the per-IP API limit).
router.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: Number(process.env.MCP_RATE_LIMIT_PER_5_MIN) || 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getBearerToken(req.headers.authorization) || req.ip || 'anonymous',
    validate: { xForwardedForHeader: false },
    handler: (_req, res) => {
      res.status(429).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSONRPC.INTERNAL_ERROR, message: 'Too many requests. Please slow down and try again shortly.' }
      });
    }
  })
);

type Authenticated = { ctx: ToolContext };

async function authenticate(req: Request, res: Response): Promise<Authenticated | null> {
  const raw = getBearerToken(req.headers.authorization);
  if (!raw) {
    res.status(401).set('WWW-Authenticate', wwwAuthenticate(req)).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSONRPC.INVALID_REQUEST, message: 'Authentication required' }
    });
    return null;
  }

  const check = await validateAccessToken(raw);
  if (!check.ok) {
    if (check.reason === 'connector_disabled') {
      res.status(403).json({ jsonrpc: '2.0', id: null, error: { code: JSONRPC.INVALID_REQUEST, message: check.message } });
    } else {
      res.status(401).set('WWW-Authenticate', wwwAuthenticate(req, 'invalid_token', check.message)).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSONRPC.INVALID_REQUEST, message: check.message }
      });
    }
    return null;
  }

  const { user, token } = check;
  const client = await OAuthClient.findOne({ clientId: token.clientId }).select('clientName');
  const port = process.env.PORT || 5000;

  return {
    ctx: {
      api: createApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        accessToken: raw,
        internalHeader: INTERNAL_HEADER,
        internalSecret: getInternalSecret(),
        userAgent: `Blueprint MCP connector (${(client?.clientName || 'AI assistant').replace(/[^\x20-\x7E]/g, '')})`
      }),
      user: {
        id: String(user._id),
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
        role: user.role,
        accessMode: user.accessMode,
        canUseAI: canUseAI(user)
      },
      appUrl: getFrontendUrl()
    }
  };
}

function checkProtocolHeader(req: Request, res: Response): boolean {
  const version = req.headers['mcp-protocol-version'];
  if (typeof version === 'string' && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSONRPC.INVALID_REQUEST, message: `Unsupported MCP-Protocol-Version: ${version}` }
    });
    return false;
  }
  return true;
}

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!checkProtocolHeader(req, res)) return;
    const auth = await authenticate(req, res);
    if (!auth) return;

    const result = await handlePost(req.body, {
      tools: TOOLS,
      ctx: auth.ctx,
      instructions: SERVER_INSTRUCTIONS,
      log: (message, error) => console.error(`[mcp] ${message}:`, error)
    });

    if (result.body === undefined) {
      res.status(result.status).end();
    } else {
      res.status(result.status).json(result.body);
    }
  } catch (error) {
    next(error);
  }
});

// HEAD: lets clients probe the endpoint (401 + discovery hint when not signed in).
router.head('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = await authenticate(req, res);
    if (auth) res.status(200).end();
  } catch (error) {
    next(error);
  }
});

// No server-initiated SSE stream and no sessions in stateless mode.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = await authenticate(req, res);
    if (!auth) return;
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSONRPC.INVALID_REQUEST, message: 'Use POST. This server does not offer an SSE stream.' }
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/', (_req: Request, res: Response) => {
  res.status(405).set('Allow', 'POST').end();
});

// Malformed JSON and oversized bodies become JSON-RPC errors instead of HTML pages.
router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: JSONRPC.PARSE_ERROR, message: 'Parse error: invalid JSON' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ jsonrpc: '2.0', id: null, error: { code: JSONRPC.INVALID_REQUEST, message: 'Request body too large (max 2 MB)' } });
    return;
  }
  console.error('[mcp] Unhandled error:', err);
  res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: JSONRPC.INTERNAL_ERROR, message: 'Internal server error' } });
});

export default router;
