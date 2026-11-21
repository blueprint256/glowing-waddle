import { validateArgs, JsonSchema } from './validate';
import { ApiError } from './apiClient';

/**
 * Model Context Protocol over Streamable HTTP, stateless JSON mode.
 * https://modelcontextprotocol.io/specification
 *
 * Each POST carries one JSON-RPC message (or, for 2025-03-26 clients, a batch). We answer
 * requests with a single application/json response, return 202 for notifications/responses,
 * and do not issue sessions or open SSE streams. Only the "tools" capability is offered.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const SERVER_INFO = {
  name: 'blueprint-campaigns',
  title: 'Blueprint',
  version: '1.0.0'
};

export const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition<Ctx> {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: 'object' };
  annotations: ToolAnnotations;
  /** Hide the tool from users who cannot use it (e.g. admin-only or AI tools for Part two). */
  isAvailable?: (ctx: Ctx) => boolean;
  handler: (args: any, ctx: Ctx) => Promise<unknown>;
}

/** Thrown by tool handlers for user-facing errors (bad input, nothing found, …). */
export class ToolError extends Error {}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpHandlerOptions<Ctx> {
  tools: ToolDefinition<Ctx>[];
  ctx: Ctx;
  instructions?: string;
  log?: (message: string, error?: unknown) => void;
}

export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

function errorResponse(id: JsonRpcResponse['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function isValidId(id: unknown): id is string | number {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

export function toolResultText(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export function availableTools<Ctx>(tools: ToolDefinition<Ctx>[], ctx: Ctx): ToolDefinition<Ctx>[] {
  return tools.filter((t) => !t.isAvailable || t.isAvailable(ctx));
}

export function describeTool<Ctx>(tool: ToolDefinition<Ctx>) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, openWorldHint: false, ...tool.annotations }
  };
}

async function callTool<Ctx>(params: any, opts: McpHandlerOptions<Ctx>, id: string | number): Promise<JsonRpcResponse> {
  const name = params?.name;
  if (typeof name !== 'string') return errorResponse(id, JSONRPC.INVALID_PARAMS, 'params.name is required');

  const tool = availableTools(opts.tools, opts.ctx).find((t) => t.name === name);
  if (!tool) {
    const exists = opts.tools.some((t) => t.name === name);
    return errorResponse(
      id,
      JSONRPC.INVALID_PARAMS,
      exists ? `Tool "${name}" is not available for this account` : `Unknown tool: ${name}`
    );
  }

  const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
  const problems = validateArgs(tool.inputSchema, args);
  if (problems.length) {
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `Invalid arguments: ${problems.join('; ')}` }], isError: true }
    };
  }

  try {
    const data = await tool.handler(args, opts.ctx);
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: toolResultText(data) }], isError: false } };
  } catch (error) {
    let text: string;
    if (error instanceof ToolError) {
      text = error.message;
    } else if (error instanceof ApiError) {
      text = `Error (HTTP ${error.status}): ${error.message}`;
    } else {
      opts.log?.(`Tool ${name} failed unexpectedly`, error);
      text = 'Unexpected server error while running this tool. Please try again.';
    }
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
  }
}

/** Handle one JSON-RPC message. Returns null when no response is due (notifications, client responses). */
export async function handleMessage<Ctx>(message: unknown, opts: McpHandlerOptions<Ctx>): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return errorResponse(null, JSONRPC.INVALID_REQUEST, 'Invalid JSON-RPC message');
  }
  const msg = message as Record<string, any>;
  if (msg.jsonrpc !== '2.0') {
    return errorResponse(isValidId(msg.id) ? msg.id : null, JSONRPC.INVALID_REQUEST, 'jsonrpc must be "2.0"');
  }

  // A response to a server-initiated request (we never send any) or a notification: nothing to return.
  if (typeof msg.method !== 'string') return null;
  if (msg.id === undefined) return null;
  if (!isValidId(msg.id)) return errorResponse(null, JSONRPC.INVALID_REQUEST, 'id must be a string or number');

  const id = msg.id;
  switch (msg.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiateProtocolVersion(msg.params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          ...(opts.instructions ? { instructions: opts.instructions } : {})
        }
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: availableTools(opts.tools, opts.ctx).map(describeTool) } };
    case 'tools/call':
      return callTool(msg.params, opts, id);
    default:
      return errorResponse(id, JSONRPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

/**
 * Handle an HTTP POST body. Returns the HTTP status and JSON body to send
 * (body undefined → 202 Accepted with no content).
 */
export async function handlePost<Ctx>(payload: unknown, opts: McpHandlerOptions<Ctx>): Promise<{ status: number; body?: unknown }> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return { status: 400, body: errorResponse(null, JSONRPC.INVALID_REQUEST, 'Empty batch') };
    }
    const responses: JsonRpcResponse[] = [];
    for (const message of payload) {
      const response = await handleMessage(message, opts);
      if (response) responses.push(response);
    }
    return responses.length ? { status: 200, body: responses } : { status: 202 };
  }

  const response = await handleMessage(payload, opts);
  if (!response) return { status: 202 };
  const status = response.error && response.error.code === JSONRPC.INVALID_REQUEST ? 400 : 200;
  return { status, body: response };
}
