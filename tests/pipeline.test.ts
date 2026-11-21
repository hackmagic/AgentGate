import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAuditStore } from '../src/audit/store.js';
import { AgentGate, auditStage, inboxStage, SignalInbox, throttleStage, ThrottleState } from '../src/gate/index.js';
import { makeEvent, makePolicy, NOW, TZ } from './helpers.js';

/**
 * The gate is a *composition*: the pure evaluator plus ordered middleware.
 * These tests pin the composition itself — order, replaceability and the fact
 * that a stage can be swapped without touching decision logic.
 */

function newGate(overrides: Partial<ConstructorParameters<typeof AgentGate>[0]> = {}) {
  const audit = new MemoryAuditStore();
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'p', decision: 'suggest' })],
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
    signal_id_factory: () => 'sig-1',
    ...overrides,
  });
  return { gate, audit };
}

test('the pipeline is inspectable and ordered', () => {
  const { gate } = newGate();
  assert.deepEqual(gate.pipeline, ['throttle', 'inbox', 'audit']);
});

test('custom stages compose on top of the exported defaults', () => {
  const seen: string[] = [];
  const audit = new MemoryAuditStore();
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'p' })],
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
    signal_id_factory: () => 'sig-1',
    stages: [
      throttleStage(new ThrottleState(), { presentation_window_minutes: 30 }),
      inboxStage(new SignalInbox()),
      auditStage({ store: audit, engine_version: '0.1.0' }),
      {
        name: 'spy',
        before: () => seen.push('before'),
        after: (call) => seen.push(`after:${call.result?.decision ?? 'none'}`),
      },
    ],
  });

  assert.deepEqual(gate.pipeline, ['throttle', 'inbox', 'audit', 'spy']);
  gate.evaluate(makeEvent());
  assert.deepEqual(seen, ['before', 'after:suggest']);
});

test('the default chain is replaceable: a bare gate decides but never queues', () => {
  const audit = new MemoryAuditStore();
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'p' })],
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
    signal_id_factory: () => 'sig-x',
    // No middleware at all: the pure evaluator still runs.
    stages: [],
  });

  const outcome = gate.evaluate(makeEvent());
  assert.equal(outcome.decision, 'suggest');
  assert.ok(outcome.signal !== null, 'the decision still carries a signal');

  // Nothing is throttled, queued or audited without the stages that do it.
  assert.deepEqual(gate.pipeline, []);
  assert.equal(gate.pending().length, 0);
  assert.equal(audit.query({}).length, 0);
});

test('the audit stage records the post-downgrade outcome, not the raw match', () => {
  const { gate, audit } = newGate({ presentation_window_minutes: 30 });

  gate.evaluate(makeEvent({ id: 'e1' }), new Date(NOW));
  const before = audit.query({});
  assert.equal(before[0]?.reason, 'matched');
  assert.equal(before[0]?.decision, 'suggest');

  // Inside the presentation window the same policy is throttled...
  const throttled = gate.evaluate(makeEvent({ id: 'e2' }), new Date(Date.parse(NOW) + 60_000));
  assert.equal(throttled.throttled, true);

  // ...and the audit says so, with no signal id: the throttle stage ran first.
  const lines = audit.query({});
  const limited = lines.find((record) => record.reason === 'rate_limited');
  assert.ok(limited !== undefined);
  assert.equal(limited.decision, 'allow');
  assert.equal(limited.signal_id, null);
  assert.equal(limited.event_id, 'e2');
});

test('stages that throw cannot produce a malformed audit line', () => {
  const audit = new MemoryAuditStore();
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'p' })],
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
    signal_id_factory: () => 'sig-y',
    stages: [
      throttleStage(new ThrottleState(), { presentation_window_minutes: 30 }),
      {
        name: 'explode',
        after: () => {
          throw new Error('stage blew up');
        },
      },
      auditStage({ store: audit, engine_version: '0.1.0' }),
    ],
  });

  assert.throws(() => gate.evaluate(makeEvent()), /stage blew up/);
  // Every line that does exist is still a complete, whitelisted record.
  for (const record of audit.query({})) {
    assert.equal(Object.keys(record).length, 9);
  }
});

test('an invalid action leaves the signal pending for a valid answer', () => {
  const policy = makePolicy({
    id: 'only-approve',
    presentation: {
      animation_hint: 'alert',
      bubble_text: '好吧？',
      actions: [{ label: '好', action_id: 'approve' }],
    },
  });
  const gate = new AgentGate({
    policies: [policy],
    audit: new MemoryAuditStore(),
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
    signal_id_factory: () => 'sig-z',
  });

  const outcome = gate.evaluate(makeEvent());
  const signalId = outcome.signal?.id;
  assert.ok(signalId !== undefined);

  assert.throws(
    () => gate.respond({ signal_id: signalId, action_id: 'mute_1h', responded_at: NOW }),
    (error: unknown) => (error as { code?: string }).code === 'invalid_action',
  );

  assert.equal(gate.pending().length, 1, 'the signal must survive a rejected action');
  assert.doesNotThrow(() => gate.respond({ signal_id: signalId, action_id: 'approve', responded_at: NOW }));
  assert.equal(gate.pending().length, 0);
});

test('answering twice is an unknown signal, not a silent no-op', () => {
  const { gate } = newGate();
  gate.evaluate(makeEvent());
  const signalId = gate.pending()[0]?.id;
  assert.ok(signalId !== undefined);

  gate.respond({ signal_id: signalId, action_id: 'dismiss', responded_at: NOW });
  assert.equal(gate.pending().length, 0);
  assert.throws(
    () => gate.respond({ signal_id: signalId, action_id: 'dismiss', responded_at: NOW }),
    (error: unknown) => (error as { code?: string }).code === 'unknown_signal',
  );
});
