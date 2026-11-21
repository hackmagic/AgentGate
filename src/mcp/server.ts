import { createInterface } from 'node:readline';

import { errorMessage, AgentGateError } from '../errors.js';
import type { AgentGate } from '../gate/index.js';
import { normalizeEvent } from '../events/normalize.js';
import { loadSchema } from '../schema/load.js';
import type { JsonSchema } from '../schema/validator.js';
import { ENGINE_VERSION } from '../version.js';

/** Stateless MCP core revision this server targets. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const SERVER_NAME = 'agent-gate';

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export const TOOL_NAMES = ['gate/evaluate', 'gate/list-policies', 'gate/audit-query'] as const;

export function toolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'gate/evaluate',
      description:
        'Evaluate one normalized event against the loaded gate policies. Returns the matched policy decision and, when the policy asks the user something, a gate signal to present.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['event'],
        properties: {
          event: loadSchema('event'),
        },
      },
    },
    {
      name: 'gate/list-policies',
      description: 'List the loaded gate policies with their trigger, decision and approval requirements.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      name: 'gate/audit-query',
      description:
        'Query the content-free gate audit trail. Records never contain window titles, screenshots, clipboard or keystrokes.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          since: { type: 'string', format: 'date-time' },
          policy_id: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 0 },
        },
      },
    },
  ];
}

export class McpServer {
  constructor(private readonly engine: AgentGate) {}

  /** Handle one JSON-RPC message. Returns null for notifications. */
  async handle(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isRecord(message) || message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string') {
      return errorResponse(null, -32600, 'invalid JSON-RPC request');
    }

    const request = message as unknown as JsonRpcRequest;
    const id = request.id ?? null;
    const isNotification = !('id' in message);

    try {
      const result = await this.dispatch(request.method, request.params ?? {});
      if (isNotification) return null;
      if (result === NO_RESULT) return null;
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (isNotification) return null;
      if (error instanceof RpcError) return errorResponse(id, error.code, error.message);
      return errorResponse(id, -32603, errorMessage(error));
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: SERVER_NAME,
            version: this.engine.engineVersionNumber,
            title: 'AgentGate',
          },
          instructions:
            'Personal gate policies compiled for agents. Call gate/evaluate with a normalized event before acting; respect the returned decision.',
        };

      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/progress':
        return NO_RESULT;

      case 'ping':
        return {};

      case 'tools/list':
        return { tools: toolDefinitions() };

      case 'tools/call':
        return this.callTool(params);

      case 'server/discover':
        return {
          name: SERVER_NAME,
          version: this.engine.engineVersionNumber,
          protocolVersion: MCP_PROTOCOL_VERSION,
          stateless: true,
          capabilities: { tools: {} },
          tools: TOOL_NAMES,
          policies: this.engine.listPolicies().length,
        };

      default:
        throw new RpcError(-32601, `method not found: ${method}`);
    }
  }

  private callTool(params: Record<string, unknown>): unknown {
    const name = params['name'];
    if (typeof name !== 'string') throw new RpcError(-32602, 'tools/call requires a tool name');
    const args = isRecord(params['arguments']) ? params['arguments'] : {};

    try {
      switch (name) {
        case 'gate/evaluate': {
          const event = normalizeEvent(args['event']);
          const outcome = this.engine.evaluate(event);
          const payload = {
            decision: outcome.decision,
            signal: outcome.signal,
            matched_policy_id: outcome.matched_policy_id,
            degraded: outcome.degraded,
            throttled: outcome.throttled,
            warnings: outcome.warnings,
          };
          return toolResult(
            payload,
            outcome.signal === null ? `decision: ${outcome.decision}` : `signal for ${outcome.signal.policy_id}`,
          );
        }

        case 'gate/list-policies': {
          const policies = this.engine.listPolicies();
          return toolResult({ policies }, `${policies.length} policies loaded`);
        }

        case 'gate/audit-query': {
          const query: { since?: string; policy_id?: string; limit?: number } = {};
          if (typeof args['since'] === 'string') query.since = args['since'];
          if (typeof args['policy_id'] === 'string') query.policy_id = args['policy_id'];
          if (typeof args['limit'] === 'number') query.limit = args['limit'];
          const records = this.engine.queryAudit(query);
          return toolResult({ records }, `${records.length} audit records`);
        }

        default:
          throw new RpcError(-32602, `unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof AgentGateError) {
        return {
          content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
          isError: true,
        };
      }
      throw error;
    }
  }
}

const NO_RESULT = Symbol('no-result');

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

function toolResult(structured: Record<string, unknown>, text: string): unknown {
  return {
    content: [{ type: 'text', text: `${text}\n${JSON.stringify(structured)}` }],
    structuredContent: structured,
    isError: false,
  };
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface StdioServer {
  /** Resolves when the input stream closes. */
  done: Promise<void>;
  close(): void;
}

/**
 * Newline-delimited JSON-RPC over stdio — the transport MCP hosts expect.
 * Stateless: every request carries everything it needs.
 */
export function serveStdio(
  engine: AgentGate,
  streams: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stdout,
  },
): StdioServer {
  const server = new McpServer(engine);
  const lines = createInterface({ input: streams.input, crlfDelay: Infinity });

  const done = new Promise<void>((resolve) => {
    lines.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      void route(trimmed);
    });
    lines.on('close', () => resolve());
  });

  async function route(trimmed: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      streams.output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      return;
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) {
      const response = await server.handle(message);
      if (response !== null) streams.output.write(`${JSON.stringify(response)}\n`);
    }
  }

  return {
    done,
    close() {
      lines.close();
    },
  };
}

export { ENGINE_VERSION };
