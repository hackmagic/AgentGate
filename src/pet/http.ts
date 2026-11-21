import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { ContractError, errorMessage, AgentGateError } from '../errors.js';
import { PetBridge, RateLimitError, type PetBridgeOptions } from './bridge.js';

export interface PetServerOptions extends PetBridgeOptions {
  host?: string;
  port?: number;
  /** Maximum accepted request body size in bytes. */
  max_body_bytes?: number;
}

export interface PetServer {
  server: Server;
  bridge: PetBridge;
  /** Actual bound URL (useful when port is 0). */
  url(): string;
  close(): Promise<void>;
}

export const DEFAULT_PET_PORT = 3778;
export const MAX_BODY_BYTES = 64 * 1024;

export function createPetServer(options: PetServerOptions): PetServer {
  const bridge = new PetBridge(options);
  const maxBody = options.max_body_bytes ?? MAX_BODY_BYTES;

  const server = createServer((request, response) => {
    handle(bridge, request, response, maxBody).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      writeError(response, error);
    });
  });

  return {
    server,
    bridge,
    url() {
      const address = server.address();
      if (address === null || typeof address === 'string') return `http://${options.host ?? '127.0.0.1'}`;
      return `http://${address.address}:${address.port}`;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function listen(server: Server, host = '127.0.0.1', port = DEFAULT_PET_PORT): Promise<void> {
  // Port 0 asks the OS for any free port, and it may hand back one that the
  // fetch standard blocks (4000, 6666, …). Node's own `fetch` then refuses to
  // reach the bridge, so retry until we land on a usable one — otherwise the
  // failure surfaces later as an inscrutable "bad port".
  const attempts = port === 0 ? MAX_EPHEMERAL_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (address === null || typeof address === 'string') return;
    if (!isFetchBlockedPort(address.port)) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  throw new Error(`could not obtain an ephemeral port reachable by fetch after ${attempts} attempts`);
}

/**
 * Ports the WHATWG fetch standard forbids client requests to, mirrored from
 * undici's `badPorts`. A bridge bound to one of these is unreachable from
 * every standards-compliant HTTP client, including Node's own.
 */
const FETCH_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

export function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.has(port);
}

const MAX_EPHEMERAL_ATTEMPTS = 16;

async function handle(bridge: PetBridge, request: IncomingMessage, response: ServerResponse, maxBody: number) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const method = request.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/healthz') {
    writeJson(response, 200, bridge.health());
    return;
  }

  if (method === 'GET' && url.pathname === '/v1/signals/pending') {
    writeJson(response, 200, { signals: bridge.pending() });
    return;
  }

  if (method === 'POST' && url.pathname === '/v1/events') {
    const body = await readJsonBody(request, maxBody);
    const now = parseOptionalInstant(request.headers['x-agent-gate-now']);
    writeJson(response, 200, bridge.handleEvent(body, now));
    return;
  }

  const respondMatch = /^\/v1\/signals\/([^/]+)\/respond$/.exec(url.pathname);
  if (method === 'POST' && respondMatch !== null) {
    const signalId = decodeURIComponent(respondMatch[1] ?? '');
    const body = await readJsonBody(request, maxBody);
    writeJson(response, 200, bridge.handleResponse(signalId, body));
    return;
  }

  writeJson(response, 404, { error: { code: 'not_found', message: `no route for ${method} ${url.pathname}` } });
}

async function readJsonBody(request: IncomingMessage, maxBody: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.length;
    if (total > maxBody) {
      throw new ContractError('body_too_large', `request body exceeds ${maxBody} bytes`);
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) throw new ContractError('empty_body', 'request body must be JSON');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ContractError('invalid_json', 'request body is not valid JSON');
  }
}

function parseOptionalInstant(header: string | string[] | undefined): Date {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return new Date();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

export function errorStatus(error: unknown): number {
  if (error instanceof RateLimitError) return 429;
  if (error instanceof ContractError) return 400;
  if (error instanceof AgentGateError) {
    return error.code === 'unknown_signal' || error.code === 'invalid_action' ? 404 : 400;
  }
  return 500;
}

function writeError(response: ServerResponse, error: unknown): void {
  const body: { error: { code: string; message: string; retry_after_seconds?: number } } = {
    error: {
      code: error instanceof AgentGateError ? error.code : 'internal_error',
      message: errorMessage(error),
    },
  };
  if (error instanceof RateLimitError) body.error.retry_after_seconds = error.retryAfterSeconds;
  writeJson(response, errorStatus(error), body);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}
