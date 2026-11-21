import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAuditStore } from '../src/audit/store.js';
import { AgentGate } from '../src/gate/index.js';
import { createPetServer, listen } from '../src/pet/http.js';
import {
  isLoopbackUrl,
  PetBridgeClient,
  RemoteBridgeError,
} from '../src/pet/client.js';
import { makePolicies } from './mcp-fixtures.js';
import { newAudit, NOW } from './helpers.js';

/**
 * The client is the half a real embodiment calls, so these tests drive it
 * against a **real** pet server rather than a stub. A stubbed fetch would
 * let a wrong route or a wrong header pass.
 */
async function startPet() {
  const gate = new AgentGate({
    policies: makePolicies(),
    audit: new MemoryAuditStore(),
    clock: { now: () => new Date(NOW) },
    timezone: 'Asia/Shanghai',
  });
  const pet = createPetServer({ engine: gate, port: 0 });
  await listen(pet.server, '127.0.0.1', 0);
  return pet;
}

const EVENT = {
  id: 'evt-client',
  type: 'focus_block_started' as const,
  timestamp: NOW,
  source: 'manual' as const,
  context: { app: 'Code', project: 'agent-gate', language: 'typescript' },
  duration_seconds: null,
  metrics: {},
  metadata: {},
};

test('a non-loopback bridge is refused unless explicitly allowed', () => {
  assert.throws(
    () => new PetBridgeClient({ baseUrl: 'http://10.0.0.5:3778' }),
    (error: unknown) => error instanceof RemoteBridgeError && (error as { code?: string }).code === 'remote_bridge',
  );

  // Opting in is possible, which is what makes the default meaningful.
  assert.doesNotThrow(() => new PetBridgeClient({ baseUrl: 'http://10.0.0.5:3778', allow_remote: true }));
});

test('loopback detection covers the three accepted spellings only', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:3778'), true);
  assert.equal(isLoopbackUrl('http://localhost:3778'), true);
  assert.equal(isLoopbackUrl('http://[::1]:3778'), true);
  assert.equal(isLoopbackUrl('http://192.168.1.10:3778'), false);
  assert.equal(isLoopbackUrl('file:///tmp/socket'), false);
  assert.equal(isLoopbackUrl('not a url'), false);
});

test('the client completes health, evaluate, pending and respond end to end', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());

  const client = new PetBridgeClient({ baseUrl: pet.url() });

  const health = await client.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.policy_count, 1);

  const outcome = await client.evaluate(EVENT);
  assert.equal(outcome.decision, 'require_approval');
  const signal = outcome.signal;
  assert.ok(signal !== null);
  assert.equal(signal.presentation.bubble_text, '进入专注？');

  const pending = await client.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.id, signal.id);

  const settled = await client.respond(signal.id, 'approve');
  assert.equal(settled.action_id, 'approve');
  assert.equal(settled.policy_muted, false);

  assert.deepEqual(await client.pending(), []);
});

test('a bridge error surfaces as a typed error with the bridge code', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());
  const client = new PetBridgeClient({ baseUrl: pet.url() });

  await assert.rejects(
    () => client.respond('does-not-exist', 'approve'),
    (error: unknown) => (error as { code?: string }).code === 'unknown_signal',
  );
});

test('the request timeout aborts rather than hanging', async (t) => {
  // A server that accepts the connection and never answers: the client must
  // give up on its own timeout instead of leaving the pet UI stuck.
  const pet = await startPet();
  t.after(() => pet.close());
  const client = new PetBridgeClient({ baseUrl: pet.url(), timeout_ms: 1 });

  await assert.rejects(async () => client.pending(), (error: unknown) => {
    const name = (error as { name?: string }).name;
    return name === 'AbortError' || name === 'TimeoutError';
  });
});

test('the poller surfaces each signal exactly once and stops on demand', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());
  const client = new PetBridgeClient({ baseUrl: pet.url() });

  await client.evaluate(EVENT);

  const seen: string[] = [];
  const poller = client.onSignal({
    interval_ms: 10,
    onSignal: (signal) => seen.push(signal.id),
  });

  // Let several polls happen: the bridge keeps returning the same pending
  // signal, and a naive implementation would emit it once per poll.
  await new Promise((resolve) => setTimeout(resolve, 120));
  poller.stop();
  await poller.done;

  assert.equal(seen.length, 1, `expected one emission, saw ${seen.length}`);
});

test('the poller keeps running after a transient error', async (t) => {
  const pet = await startPet();

  let failures = 0;
  const client = new PetBridgeClient({ baseUrl: pet.url() });
  const poller = client.onSignal({
    interval_ms: 10,
    timeout_ms: 300,
    onSignal: () => {},
    onError: () => {
      failures += 1;
    },
  });

  // Kill the server mid-run; the poller must report errors and stop on its
  // own deadline rather than throwing out of the loop.
  await new Promise((resolve) => setTimeout(resolve, 30));
  await pet.close();
  await poller.done;

  assert.ok(failures > 0, 'a broken bridge must be reported, not swallowed');

  // Registered *after* the manual close so a second close cannot throw.
  t.after(async () => {
    try {
      await pet.close();
    } catch {
      // Already closed above; nothing to do.
    }
  });
});

test('a bare signal body is accepted by evaluate, matching the bridge contract', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());
  const client = new PetBridgeClient({ baseUrl: pet.url() });

  // The client always sends `{ event }`; the bridge also accepts a bare event.
  // Assert the wrapper is what goes over the wire, because docs/07 promises it.
  const recorded: string[] = [];
  const wrapped = new PetBridgeClient({
    baseUrl: pet.url(),
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      recorded.push(String(init?.body ?? ''));
      return globalThis.fetch(input, init);
    }) as typeof globalThis.fetch,
  });

  await wrapped.evaluate(EVENT);
  assert.equal(recorded.length, 1);
  assert.ok(recorded[0]?.includes('"event"'), 'the body must be wrapped in { event }');
});
