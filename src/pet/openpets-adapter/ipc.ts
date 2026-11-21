import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {
  CONNECT_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  OPENPETS_PROTOCOL_VERSION,
  RESPONSE_TIMEOUT_MS,
  isReaction,
  type Reaction,
} from './contract.js';
import type { PetTransport } from './adapter.js';

/**
 * The local IPC transport.
 *
 * This speaks the documented OpenPets wire format directly — line-delimited
 * JSON, one connection per call, carrying the token from the discovery file —
 * rather than depending on `@open-pets/client`. That keeps AgentGate free of a
 * runtime dependency, and it means the adapter works anywhere a discovery file
 * exists.
 *
 * **Degrade, never block.** The pet app may be closed, updating, or speaking an
 * older protocol. Every method fails fast, and the caller swallows the failure:
 * an unavailable pet is a normal state, not an error for the agent.
 */

export interface DiscoveryFile {
  version: string;
  endpoint: string;
  token: string;
}

/** The slice of a socket this transport needs, so tests can supply a fake. */
export interface SocketLike {
  write(data: string): void;
  end(): void;
  onData(listener: (chunk: string) => void): void;
  onError(listener: (error: unknown) => void): void;
  onClose(listener: () => void): void;
}

export interface IpcTransportOptions {
  /** Explicit discovery file; defaults to the platform location. */
  discoveryPath?: string;
  /** Injected connector, for tests and for non-Node hosts. */
  connect?: (endpoint: string) => Promise<SocketLike>;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
}

/** A transport failure the caller is expected to swallow. */
export class OpenPetsUnavailableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OpenPetsUnavailableError';
    this.code = code;
  }
}

/**
 * Resolve the discovery file for this platform.
 *
 * `OPENPETS_DISCOVERY_FILE` wins first, deliberately: the exact directory is an
 * OpenPets implementation detail that has moved between releases, and a user
 * diagnosing a broken integration should not need a patched adapter.
 */
export function defaultDiscoveryPath(platform: NodeJS.Platform = process.platform): string {
  const override = process.env['OPENPETS_DISCOVERY_FILE'];
  if (typeof override === 'string' && override.trim() !== '') return override;

  if (platform === 'darwin') {
    return path.join(process.env['HOME'] ?? '~', 'Library', 'Application Support', 'OpenPets', 'local-ipc.json');
  }
  if (platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? '', 'OpenPets', 'local-ipc.json');
  }
  const runtime = process.env['XDG_RUNTIME_DIR'];
  return runtime === undefined
    ? path.join(process.env['HOME'] ?? '~', '.config', 'OpenPets', 'local-ipc.json')
    : path.join(runtime, 'openpets', 'local-ipc.json');
}

/**
 * Read and validate the discovery file.
 *
 * Strict on purpose: a malformed or hostile discovery file must not become a
 * connection to an arbitrary endpoint. The token is returned to the caller and
 * never included in an error message.
 */
export function readDiscovery(file: string): DiscoveryFile {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new OpenPetsUnavailableError('discovery_missing', 'OpenPets discovery file is not present');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OpenPetsUnavailableError('discovery_invalid', 'OpenPets discovery file is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OpenPetsUnavailableError('discovery_invalid', 'OpenPets discovery file is not an object');
  }
  const record = parsed as Record<string, unknown>;

  const endpoint = record['endpoint'];
  const token = record['token'];
  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw new OpenPetsUnavailableError('discovery_invalid', 'OpenPets discovery file has no endpoint');
  }
  if (typeof token !== 'string' || token.trim() === '') {
    throw new OpenPetsUnavailableError('discovery_invalid', 'OpenPets discovery file has no token');
  }

  return {
    version: typeof record['version'] === 'string' ? record['version'] : OPENPETS_PROTOCOL_VERSION,
    endpoint,
    token,
  };
}

/**
 * Connect to the documented endpoint shape.
 *
 * The contract lists a Unix domain socket, a Windows named pipe, or private
 * loopback TCP. The path/pipe cases are the common ones; a `tcp://host:port`
 * endpoint is supported because that is how a WSL client reaches a Windows
 * host, and refusing it would make the adapter unusable in exactly the setup
 * the reference documents.
 */
export function connectToEndpoint(endpoint: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<SocketLike> {
  return new Promise((resolve, reject) => {
    const target = parseEndpoint(endpoint);
    const socket = net.createConnection(target);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new OpenPetsUnavailableError('connect_timeout', 'OpenPets did not accept the connection in time'));
    }, timeoutMs);
    timer.unref?.();

    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(adaptSocket(socket));
    });

    socket.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new OpenPetsUnavailableError('connect_failed', `cannot reach OpenPets: ${error.message}`));
    });
  });
}

function parseEndpoint(endpoint: string): net.NetConnectOpts {
  if (endpoint.startsWith('tcp://')) {
    const url = new URL(endpoint);
    if (url.hostname === '' || url.port === '') {
      throw new OpenPetsUnavailableError('discovery_invalid', 'OpenPets tcp endpoint is missing host or port');
    }
    return { host: url.hostname, port: Number(url.port) };
  }
  // `\\.\pipe\...` (Windows) and every Unix socket path take the same option.
  return { path: endpoint };
}

function adaptSocket(socket: net.Socket): SocketLike {
  return {
    write: (data) => void socket.write(data),
    end: () => socket.end(),
    onData: (listener) => socket.on('data', (chunk: Buffer) => listener(chunk.toString('utf8'))),
    onError: (listener) => socket.on('error', listener),
    onClose: (listener) => socket.on('close', listener),
  };
}

interface JsonRpcResponse {
  ok?: boolean;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

/**
 * One request, one connection, one response line.
 *
 * Capped at 16KB and two timeouts, matching the published protocol: a pet call
 * that hangs must not become an agent call that hangs.
 */
export async function sendRequest(
  discovery: DiscoveryFile,
  method: string,
  params: Record<string, unknown> = {},
  options: { connect?: (endpoint: string) => Promise<SocketLike>; responseTimeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const connector = options.connect ?? ((endpoint: string) => connectToEndpoint(endpoint));
  const responseTimeout = options.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS;
  const socket = await connector(discovery.endpoint);

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.end();
      } catch {
        // Closing a dead socket is not interesting.
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new OpenPetsUnavailableError('response_timeout', `OpenPets did not answer ${method} in time`)));
    }, responseTimeout);
    timer.unref?.();

    socket.onData((chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_MESSAGE_BYTES) {
        finish(() => reject(new OpenPetsUnavailableError('response_too_large', 'OpenPets response exceeded the size cap')));
        return;
      }

      const newline = buffer.indexOf('\n');
      if (newline === -1) return;

      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);

      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(line) as JsonRpcResponse;
      } catch {
        finish(() => reject(new OpenPetsUnavailableError('response_invalid', 'OpenPets sent a non-JSON response')));
        return;
      }

      if (parsed.ok === false) {
        // Never echo the endpoint or token: those are the things that leak.
        const code = typeof parsed.code === 'string' ? parsed.code : 'request_failed';
        finish(() => reject(new OpenPetsUnavailableError(code, `OpenPets refused ${method}`)));
        return;
      }

      finish(() => resolve(parsed));
    });

    socket.onError(() => {
      finish(() => reject(new OpenPetsUnavailableError('socket_error', `OpenPets connection failed during ${method}`)));
    });

    socket.onClose(() => {
      finish(() => reject(new OpenPetsUnavailableError('socket_closed', 'OpenPets closed the connection')));
    });

    socket.write(
      `${JSON.stringify({
        id: `${method}-${Date.now().toString(36)}`,
        version: OPENPETS_PROTOCOL_VERSION,
        token: discovery.token,
        method,
        params,
      })}\n`,
    );
  });
}

/**
 * The `PetTransport` implementation backed by real IPC.
 *
 * Every method re-reads the discovery file rather than caching the token: the
 * app rotates the file when it restarts, and a cached token would fail exactly
 * once per restart in a way that looks like flakiness.
 */
export function createIpcTransport(options: IpcTransportOptions = {}): PetTransport {
  const discoveryPath = options.discoveryPath ?? defaultDiscoveryPath();
  const connector = options.connect;

  const call = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const discovery = readDiscovery(discoveryPath);
    return sendRequest(discovery, method, params, {
      ...(connector === undefined ? {} : { connect: connector }),
      ...(options.responseTimeoutMs === undefined ? {} : { responseTimeoutMs: options.responseTimeoutMs }),
    });
  };

  return {
    async acquire() {
      const response = await call('lease.acquire');
      const leaseId = response['leaseId'];
      if (typeof leaseId !== 'string' || leaseId === '') {
        throw new OpenPetsUnavailableError('lease_missing', 'OpenPets did not return a lease id');
      }
      return leaseId;
    },

    async heartbeat(leaseId: string) {
      await call('lease.heartbeat', { leaseId });
    },

    async release(leaseId: string) {
      await call('lease.release', { leaseId });
    },

    async react(reaction: Reaction, leaseId: string | null) {
      if (!isReaction(reaction)) {
        throw new OpenPetsUnavailableError('invalid_reaction', 'refusing to send a reaction outside the allowed set');
      }
      await call('pet.react', leaseId === null ? { reaction } : { reaction, leaseId });
    },

    async say(message: string, leaseId: string | null) {
      await call('pet.say', leaseId === null ? { message } : { message, leaseId });
    },
  };
}
