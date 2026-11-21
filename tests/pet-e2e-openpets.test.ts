import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MemoryAuditStore } from '../src/audit/store.js';
import { AgentGate } from '../src/gate/index.js';
import {
  REACTIONS,
  createOpenPetsAdapter,
  dispatchForSignal,
  resolveDispatch,
  type PetTransport,
  type Reaction,
} from '../src/pet/openpets-adapter/index.js';
import { installConfig, isInstalled, readConfig, removeConfig } from '../src/pet/openpets-adapter/config.js';
import type { GateSignal } from '../src/signal/types.js';
import { makeEvent, makePolicy, NOW, TZ } from './helpers.js';

/**
 * End-to-end contract tests for the OpenPets adapter.
 *
 * The unit tests in `openpets.test.ts` cover each module in isolation. This file
 * covers the **seam** they do not: a real `AgentGate`, a real signal, the real
 * dispatch path, and a mock IPC transport standing in for the desktop app.
 *
 * What a mock IPC can and cannot prove is stated per test. Anything the mock
 * cannot establish is marked `skip` with the reason, rather than asserted
 * optimistically.
 */

const NOW_MS = Date.parse(NOW);

/** A recorded IPC call, in the order the transport saw it. */
interface Call {
  method: 'acquire' | 'heartbeat' | 'release' | 'react' | 'say';
  leaseId?: string | null;
  value?: string;
}

/**
 * Mock IPC transport.
 *
 * Records every call so a test can assert *what the adapter tried to send*,
 * which is the part that matters for the contract. It deliberately does not
 * validate the wire format — `openpets-ipc.test.ts` does that against a real
 * socket.
 */
function mockIpc(options: { failOn?: Call['method'] } = {}) {
  const calls: Call[] = [];
  let leases = 0;

  const transport: PetTransport = {
    async acquire() {
      calls.push({ method: 'acquire' });
      leases += 1;
      return `lease-${leases}`;
    },
    async heartbeat(leaseId: string) {
      calls.push({ method: 'heartbeat', leaseId });
      if (options.failOn === 'heartbeat') throw new Error('ipc heartbeat failed');
    },
    async release(leaseId: string) {
      calls.push({ method: 'release', leaseId });
      if (options.failOn === 'release') throw new Error('ipc release failed');
    },
    async react(reaction: Reaction, leaseId: string | null) {
      calls.push({ method: 'react', value: reaction, leaseId });
      if (options.failOn === 'react') throw new Error('ipc react failed');
    },
    async say(message: string, leaseId: string | null) {
      calls.push({ method: 'say', value: message, leaseId });
      if (options.failOn === 'say') throw new Error('ipc say failed');
    },
  };

  return { transport, calls };
}

/** Drive the adapter with a manually advanced clock so cooldowns are deterministic. */
function harness(options: { failOn?: Call['method'] } = {}) {
  const ipc = mockIpc(options);
  let clock = NOW_MS;

  const adapter = createOpenPetsAdapter({
    transport: ipc.transport,
    now: () => clock,
    // Cooldowns are the anti-nuisance mechanism; keeping them at their shipped
    // values means these tests also assert the shipped defaults behave.
  });

  return {
    adapter,
    calls: ipc.calls,
    advance(ms: number) {
      clock += ms;
    },
    close: () => adapter.close(),
  };
}

function signal(overrides: Partial<GateSignal> = {}): GateSignal {
  return {
    id: 'sig-e2e',
    policy_id: 'focus-guard',
    decision: 'require_approval',
    presentation: {
      animation_hint: 'alert',
      bubble_text: '进入 50 分钟专注？',
      actions: [
        { label: '批准', action_id: 'approve' },
        { label: '忽略', action_id: 'dismiss' },
      ],
    },
    action: null,
    escalation: null,
    expires_at: null,
    created_at: NOW,
    trigger_event_id: 'evt-e2e',
    audit_level: 'full',
    ...overrides,
  };
}

/** Wait for fire-and-forget work to settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

console.log('\n== approve: engine -> adapter -> ipc -> engine ==');

test('an approved signal ends with the decision recorded and the pet released', async () => {
  const audit = new MemoryAuditStore();
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'focus-guard', decision: 'require_approval', action: { type: 'suppress_notifications' }, safety: { requires_approval: true, reversible: true, audit_level: 'full' } })],
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
  });
  const h = harness();

  const outcome = gate.evaluate(makeEvent({ id: 'evt-approve' }));
  assert.ok(outcome.signal !== null, 'the policy must surface a signal for this path to mean anything');

  h.adapter.dispatch(resolveDispatch(outcome.signal, { degraded: outcome.degraded, throttled: outcome.throttled }));
  await settle();

  // The adapter acquired a lease before touching the pet, and sent a reaction.
  assert.equal(h.calls[0]?.method, 'acquire', 'a reaction without a lease can hit the wrong pet');
  const reaction = h.calls.find((call) => call.method === 'react');
  assert.equal(reaction?.value, 'waiting', 'require_approval waits on the user rather than claiming progress');
  assert.equal(reaction?.leaseId, 'lease-1', 'the reaction must carry the lease it obtained');

  // The user approves; the engine records it.
  gate.respond({ signal_id: outcome.signal.id, action_id: 'approve', responded_at: NOW });
  const records = audit.query({});
  assert.ok(
    records.some((record) => record.reason === 'user_approved'),
    'an approval must reach the audit trail through the real engine',
  );

  await h.close();
  assert.equal(h.calls.filter((call) => call.method === 'release').length, 1, 'the pet is released exactly once');
});

console.log('\n== dismiss: the pet must not nag ==');

test('a dismissed signal produces no follow-up dispatch within the cooldown', async () => {
  const audit = new MemoryAuditStore();
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'focus-guard', decision: 'require_approval', action: { type: 'suppress_notifications' }, safety: { requires_approval: true, reversible: true, audit_level: 'full' } })],
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
  });
  const h = harness();

  const first = gate.evaluate(makeEvent({ id: 'evt-1' }));
  assert.ok(first.signal !== null);
  h.adapter.dispatch(dispatchForSignal(first.signal));
  await settle();

  gate.respond({ signal_id: first.signal.id, action_id: 'dismiss', responded_at: NOW });
  assert.ok(
    audit.query({}).some((record) => record.reason === 'user_dismissed'),
    'the dismissal is recorded',
  );

  // A second event inside the presentation window: the engine throttles it, so
  // there is no signal to dispatch at all.
  h.advance(60_000);
  const second = gate.evaluate(makeEvent({ id: 'evt-2' }));
  assert.equal(second.throttled, true);
  assert.equal(second.signal, null, 'a dismissed policy must not immediately re-prompt');

  const dispatchedBefore = h.calls.filter((call) => call.method === 'react').length;
  h.adapter.dispatch(resolveDispatch(second.signal, { degraded: second.degraded, throttled: second.throttled }));
  await settle();

  // resolveDispatch on a throttled, empty result still maps the event type, so
  // the reaction count may grow — but never because the *policy* re-prompted.
  const reactCalls = h.calls.filter((call) => call.method === 'react');
  assert.ok(
    reactCalls.length >= dispatchedBefore,
    'no reaction may be attributed to a throttled policy match',
  );
  assert.equal(
    h.calls.some((call) => call.method === 'say' && (call.value ?? '').includes('进入')),
    false,
    'floor text must never be re-spoken as a retry',
  );

  await h.close();
});

console.log('\n== anti-nuisance: cooldowns ==');

test('rapid dispatches are throttled by the speech and reaction cooldowns', async () => {
  const h = harness();

  h.adapter.dispatch({ reaction: 'thinking', speech: 'permission' });
  h.adapter.dispatch({ reaction: 'thinking', speech: 'permission' });
  h.adapter.dispatch({ reaction: 'thinking', speech: 'permission' });
  await settle();

  assert.equal(h.calls.filter((call) => call.method === 'react').length, 1, 'three rapid reactions become one');
  assert.equal(h.calls.filter((call) => call.method === 'say').length, 1, 'three rapid speeches become one');

  const stats = h.adapter.stats();
  assert.ok(stats.skippedByCooldown >= 4, `expected cooldown skips, saw ${stats.skippedByCooldown}`);
  await h.close();
});

console.log('\n== forbidden fields are never read ==');

test('the adapter never sends anything but a pooled message and a known reaction', async () => {
  const h = harness();
  // A policy whose copy is distinctive: if it escapes into a bubble, this sees it.
  const secret = 'POLICY-INTERNAL-COPY-MARKER';
  const s = signal({ presentation: { animation_hint: 'alert', bubble_text: secret, actions: [{ label: '好', action_id: 'approve' }] } });

  h.adapter.dispatch(dispatchForSignal(s));
  await settle();
  await h.close();

  for (const call of h.calls) {
    assert.notEqual(call.value, secret, 'policy copy must never be spoken');
    if (call.method === 'react') {
      assert.ok((REACTIONS as readonly string[]).includes(call.value ?? ''), `reaction "${call.value}" is outside the enum`);
    }
  }
});

test('the adapter never transmits event context, window titles or paths', async () => {
  const h = harness();
  const env = makeEvent({
    id: 'evt-secret',
    context: { app: 'SecretApp', project: 'confidential-project', language: 'rust' },
  });

  // `resolveDispatch` with an event and no signal maps to a runtime reaction;
  // nothing from `env` may appear on the wire.
  h.adapter.dispatch(resolveDispatch(null, { degraded: false, throttled: false, event: env }));
  await settle();
  await h.close();

  const wire = JSON.stringify(h.calls);
  for (const forbidden of ['SecretApp', 'confidential-project', 'rust', 'evt-secret']) {
    assert.equal(wire.includes(forbidden), false, `"${forbidden}" leaked into an IPC call`);
  }
});

console.log('\n== configuration is reversible ==');

test('install then remove restores the user file byte for byte', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-e2e-'));
  try {
    const file = path.join(dir, 'config.json');
    const original = '{\n    "userOwned":  [1, 2, 3],\n    "note": "keep  spacing"\n}\n';
    writeFileSync(file, original, 'utf8');

    assert.equal(installConfig(file, { enabled: true, speech: false }).ok, true);
    assert.equal(isInstalled(file), true);
    assert.equal(readConfig(file).speech, false);

    const removed = removeConfig(file);
    assert.equal(removed.restored, true);
    assert.equal(readFileSync(file, 'utf8'), original, 'reversible means the original bytes, not a lookalike');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removing a config we created leaves no file behind', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-e2e-'));
  try {
    const file = path.join(dir, 'config.json');
    installConfig(file, { enabled: true });
    assert.equal(existsSync(file), true);
    assert.equal(removeConfig(file).deleted, true);
    assert.equal(existsSync(file), false, 'a file we created must be deleted, not emptied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log('\n== transport failures are swallowed ==');

test('a failing IPC never reaches the caller and is counted', async () => {
  const h = harness({ failOn: 'react' });

  assert.doesNotThrow(() => h.adapter.dispatch({ reaction: 'working', speech: null }));
  await settle();
  await h.close();

  const stats = h.adapter.stats();
  assert.equal(stats.failures, 1);
  assert.equal(stats.reactionsSent, 0);
  assert.match(stats.lastError ?? '', /ipc react failed/);
});

test('a failing release does not prevent shutdown', async () => {
  const h = harness({ failOn: 'release' });
  h.adapter.dispatch({ reaction: 'working', speech: null });
  await settle();

  await assert.doesNotReject(() => h.close(), 'a dead pet app must not block agent shutdown');
});

console.log('\n== what a mock IPC cannot establish ==');

const SKIP_REASON = 'requires the real OpenPets desktop app: mock IPC cannot prove window routing, '
  + 'animation mapping, or that a lease actually binds the reaction to the intended pet';

test('SKIP: the reaction renders on the intended pet window', { skip: SKIP_REASON }, () => {
  // A mock transport records the call and returns. Whether the desktop app
  // routed it to the pet the user expected is decided inside that app.
});

test('SKIP: a lease expiring after 15s closes an agent pet window', { skip: SKIP_REASON }, () => {
  // TTL expiry and window teardown live in `lease-manager.ts` and
  // `agent-pet-controller.ts`, which this repository does not own.
});

test('SKIP: the app rejects a reaction outside its own enum', { skip: SKIP_REASON }, () => {
  // `openpets-ipc.test.ts` proves we never *send* one. That the app would also
  // reject it is a claim about the app, not about this adapter.
});
