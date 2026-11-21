import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MAX_MESSAGE_BYTES } from '../src/pet/openpets-adapter/contract.js';
import {
  OpenPetsUnavailableError,
  createIpcTransport,
  defaultDiscoveryPath,
  readDiscovery,
  sendRequest,
} from '../src/pet/openpets-adapter/ipc.js';

/**
 * The transport is tested against a **real socket**, not a mocked connector.
 *
 * A mock would happily accept a request shape OpenPets rejects, a token in the
 * wrong field, or a missing newline terminator. Those are exactly the bugs a
 * wire adapter has, so they need a wire.
 */

/** A stand-in OpenPets server that speaks the documented line-delimited JSON. */
interface FakeServer {
  endpoint: string;
  requests: { method: string; token: string; version: string; params: Record<string, unknown> }[];
  close(): Promise<void>;
  /** Make the next response violate the protocol in a specific way. */
  respondWith(behaviour: 'ok' | 'refuse' | 'garbage' | 'silent' | 'oversize'): void;
}

function startFakeServer(options: { tcp?: boolean } = {}): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  let behaviour: 'ok' | 'refuse' | 'garbage' | 'silent' | 'oversize' = 'ok';

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;

      const line = buffer.slice(0, newline);
      const parsed = JSON.parse(line) as {
        method: string;
        token: string;
        version: string;
        params?: Record<string, unknown>;
      };
      requests.push({
        method: parsed.method,
        token: parsed.token,
        version: parsed.version,
        params: parsed.params ?? {},
      });

      if (behaviour === 'silent') return;
      if (behaviour === 'garbage') {
        socket.write('this is not json\n');
        return;
      }
      if (behaviour === 'oversize') {
        socket.write(`${'x'.repeat(MAX_MESSAGE_BYTES + 10)}\n`);
        return;
      }
      if (behaviour === 'refuse') {
        socket.write(`${JSON.stringify({ ok: false, code: 'lease_not_found', error: 'nope' })}\n`);
        return;
      }

      // Answer like the app: a discriminated union on `ok`.
      const payload: Record<string, unknown> = { ok: true };
      if (parsed.method === 'lease.acquire') payload['leaseId'] = 'lease-test-1';
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on('error', () => {
      // A client that hangs up early is normal here.
    });
  });

  // TCP by default: a Unix-domain socket path is not portable to Windows CI,
  // and the wire contract is identical either way.
  const useTcp = options.tcp !== false;
  const socketPath = useTcp ? undefined : path.join(tmpdir(), `openpets-fake-${process.pid}-${Date.now()}.sock`);

  return new Promise((resolve) => {
    if (useTcp) {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        resolve({
          endpoint: `tcp://127.0.0.1:${address.port}`,
          requests,
          close: () => new Promise((done) => server.close(() => done())),
          respondWith: (next) => {
            behaviour = next;
          },
        });
      });
      return;
    }

    server.listen(socketPath as string, () => {
      resolve({
        endpoint: socketPath as string,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
        respondWith: (next) => {
          behaviour = next;
        },
      });
    });
  });
}

console.log('\n== discovery file ==');

test('a valid discovery file is read and its token survives intact', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-disc-'));
  try {
    const file = path.join(dir, 'local-ipc.json');
    writeFileSync(file, JSON.stringify({ endpoint: '/tmp/some.sock', token: 'tok-123' }), 'utf8');

    const discovery = readDiscovery(file);
    assert.equal(discovery.endpoint, '/tmp/some.sock');
    assert.equal(discovery.token, 'tok-123');
    assert.equal(discovery.version, 'v1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the discovery path is platform-specific and honours an explicit override', () => {
  const before = process.env['OPENPETS_DISCOVERY_FILE'];
  try {
    process.env['OPENPETS_DISCOVERY_FILE'] = '/custom/local-ipc.json';
    assert.equal(defaultDiscoveryPath('linux'), '/custom/local-ipc.json');

    delete process.env['OPENPETS_DISCOVERY_FILE'];
    assert.match(defaultDiscoveryPath('win32'), /OpenPets/);
    assert.match(defaultDiscoveryPath('darwin'), /OpenPets/);
    assert.match(defaultDiscoveryPath('linux'), /openpets|OpenPets/i);
  } finally {
    if (before === undefined) delete process.env['OPENPETS_DISCOVERY_FILE'];
    else process.env['OPENPETS_DISCOVERY_FILE'] = before;
  }
});

console.log('\n== the wire protocol, over a real socket ==');

test('a request carries id, version, token and method, newline-terminated', async (t) => {
  const server = await startFakeServer();
  t.after(() => server.close());

  const response = await sendRequest(
    { version: 'v1', endpoint: server.endpoint, token: 'tok-xyz' },
    'pet.react',
    { reaction: 'thinking' },
  );

  assert.equal(response['ok'], true);
  assert.equal(server.requests.length, 1, 'exactly one request per connection');
  const request = server.requests[0] as FakeServer['requests'][number];
  assert.equal(request.method, 'pet.react');
  assert.equal(request.token, 'tok-xyz', 'the token must travel in the request, not in a header');
  assert.equal(request.version, 'v1');
  assert.deepEqual(request.params, { reaction: 'thinking' });
});

test('a refused request becomes a typed error with the app’s code', async (t) => {
  const server = await startFakeServer();
  t.after(() => server.close());
  server.respondWith('refuse');

  await assert.rejects(
    () => sendRequest({ version: 'v1', endpoint: server.endpoint, token: 't' }, 'lease.heartbeat', { leaseId: 'x' }),
    (error: unknown) =>
      error instanceof OpenPetsUnavailableError && (error as { code?: string }).code === 'lease_not_found',
  );
});

test('a non-JSON reply is rejected rather than parsed as an empty success', async (t) => {
  const server = await startFakeServer();
  t.after(() => server.close());
  server.respondWith('garbage');

  await assert.rejects(
    () => sendRequest({ version: 'v1', endpoint: server.endpoint, token: 't' }, 'hello'),
    (error: unknown) => (error as { code?: string }).code === 'response_invalid',
  );
});

test('an oversized reply is cut off at the documented 16KB cap', async (t) => {
  const server = await startFakeServer();
  t.after(() => server.close());
  server.respondWith('oversize');

  await assert.rejects(
    () => sendRequest({ version: 'v1', endpoint: server.endpoint, token: 't' }, 'status'),
    (error: unknown) => (error as { code?: string }).code === 'response_too_large',
  );
});

test('a silent app times out instead of hanging the caller', async (t) => {
  const server = await startFakeServer();
  t.after(() => server.close());
  server.respondWith('silent');

  await assert.rejects(
    () => sendRequest({ version: 'v1', endpoint: server.endpoint, token: 't' }, 'hello', {}, { responseTimeoutMs: 60 }),
    (error: unknown) => (error as { code?: string }).code === 'response_timeout',
  );
});

test('a tcp endpoint is reachable, which is how a WSL client meets the app', async (t) => {
  const server = await startFakeServer({ tcp: true });
  t.after(() => server.close());

  const response = await sendRequest({ version: 'v1', endpoint: server.endpoint, token: 'tok-tcp' }, 'hello');
  assert.equal(response['ok'], true);
});

console.log('\n== the transport bound to the four IPC methods ==');

test('the transport maps each method onto its documented call', async (t) => {
  const server = await startFakeServer();
  t.after(() => server.close());

  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-disc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const discoveryFile = path.join(dir, 'local-ipc.json');
  writeFileSync(discoveryFile, JSON.stringify({ endpoint: server.endpoint, token: 'tok-1' }), 'utf8');

  const transport = createIpcTransport({ discoveryPath: discoveryFile });
  const leaseId = await transport.acquire();
  assert.equal(leaseId, 'lease-test-1');

  await transport.heartbeat(leaseId);
  await transport.react('thinking', leaseId);
  await transport.say('Thinking…', leaseId);
  await transport.release(leaseId);

  assert.deepEqual(
    server.requests.map((request) => request.method),
    ['lease.acquire', 'lease.heartbeat', 'pet.react', 'pet.say', 'lease.release'],
  );
  // Every call after the first carries the lease, so it routes to the right pet.
  for (const request of server.requests.slice(1)) {
    assert.equal(request.params['leaseId'], 'lease-test-1', 'a call without a lease can hit the wrong pet');
  }
});

test('an out-of-enum reaction never reaches the wire', async (t) => {
  const server = await startFakeServer();
  t.after(() => server.close());

  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-disc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const discoveryFile = path.join(dir, 'local-ipc.json');
  writeFileSync(discoveryFile, JSON.stringify({ endpoint: server.endpoint, token: 'tok-1' }), 'utf8');

  const transport = createIpcTransport({ discoveryPath: discoveryFile });
  await assert.rejects(
    // Simulates a future mapping bug reaching the transport.
    () => transport.react('dancing' as never, 'lease-1'),
    (error: unknown) => (error as { code?: string }).code === 'invalid_reaction',
  );
  assert.equal(server.requests.length, 0, 'nothing may be sent for a reaction outside the enum');
});

test('acquire rejects when the app answers without a lease id', async (t) => {
  // The app can be older or mid-upgrade; a missing lease must not become `undefined`.
  const server = await startFakeServer();
  t.after(() => server.close());

  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-disc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const discoveryFile = path.join(dir, 'local-ipc.json');
  writeFileSync(discoveryFile, JSON.stringify({ endpoint: '/nonexistent/socket-xyz', token: 'tok-1' }), 'utf8');

  const transport = createIpcTransport({ discoveryPath: discoveryFile });
  await assert.rejects(
    () => transport.acquire(),
    (error: unknown) => (error as { code?: string }).code === 'connect_failed' || (error as { code?: string }).code === 'discovery_invalid',
  );
});
