import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentGate } from '../src/gate/index.js';
import type { Policy } from '../src/policy/types.js';
import { makeClock, makeEvent, makePolicy, newAudit, NOW, sequentialIds, TZ } from './helpers.js';

function engineWith(policies: Policy[], options: { timezone?: string } = {}) {
  const clock = makeClock();
  const audit = newAudit();
  const engine = new AgentGate({
    policies,
    audit,
    clock,
    timezone: options.timezone ?? TZ,
    signal_id_factory: sequentialIds(),
  });
  return { engine, audit, clock };
}

test('rule 1: suppress + requires_approval only ever asks', () => {
  const policy = makePolicy({
    id: 'night-soft',
    decision: 'suppress',
    action: { type: 'mute_notifications', scope: ['all'] },
    safety: { requires_approval: true, reversible: true, audit_level: 'full' },
  });
  const { engine } = engineWith([policy]);

  const outcome = engine.evaluate(makeEvent());
  assert.equal(outcome.decision, 'require_approval');
  assert.equal(outcome.signal?.decision, 'require_approval');
  assert.equal(outcome.signal?.action?.type, 'mute_notifications');
});

test('rule 3: highest priority wins; the first non-allow decision stops evaluation', () => {
  const allowPolicy = makePolicy({ id: 'a-allow', priority: 90, decision: 'allow' });
  const askPolicy = makePolicy({
    id: 'b-ask',
    priority: 10,
    decision: 'require_approval',
    action: { type: 'suppress_notifications' },
    safety: { requires_approval: true, reversible: true, audit_level: 'full' },
  });
  const neverReached = makePolicy({ id: 'c-late', priority: 5, decision: 'suggest' });

  const { engine } = engineWith([neverReached, allowPolicy, askPolicy]);
  const outcome = engine.evaluate(makeEvent());

  assert.equal(outcome.matched_policy_id, 'b-ask');
  assert.equal(outcome.decision, 'require_approval');

  const statuses = new Map(outcome.traces.map((trace) => [trace.policy_id, trace.status]));
  assert.equal(statuses.get('a-allow'), 'matched');
  assert.equal(statuses.get('b-ask'), 'matched');
  assert.equal(statuses.has('c-late'), false, 'evaluation stops at the first non-allow decision');
});

test('rule 3: a higher-priority allow does not shadow a lower-priority real decision', () => {
  const allowPolicy = makePolicy({ id: 'a-allow', priority: 90, decision: 'allow' });
  const suggestPolicy = makePolicy({ id: 'b-suggest', priority: 20 });
  const { engine } = engineWith([allowPolicy, suggestPolicy]);

  const outcome = engine.evaluate(makeEvent());
  assert.equal(outcome.matched_policy_id, 'b-suggest');
  assert.equal(outcome.decision, 'suggest');
});

test('rule 4: a broken policy degrades to allow and is audited', () => {
  const broken = makePolicy({ id: 'broken-window', conditions: { time_window: '09:00-12:00' } });
  const { engine, audit } = engineWith([broken], { timezone: 'Mars/Olympus' });

  const outcome = engine.evaluate(makeEvent());
  assert.equal(outcome.decision, 'allow');
  assert.equal(outcome.signal, null);
  assert.equal(outcome.degraded, true);
  assert.equal(outcome.traces[0]?.status, 'error');
  assert.match(outcome.warnings[0] ?? '', /broken-window/);

  const records = audit.query({});
  assert.equal(records.length, 1);
  assert.equal(records[0]?.reason, 'degraded');
  assert.equal(records[0]?.degraded, true);
});

test('rule 5: three consecutive dismissals mute the policy', () => {
  const policy = makePolicy({ id: 'nagging' });
  const { engine, clock } = engineWith([policy]);

  for (let round = 0; round < 3; round += 1) {
    const outcome = engine.evaluate(makeEvent({ id: `evt-${round}` }));
    assert.equal(outcome.decision, 'suggest');
    const signal = outcome.signal;
    assert.ok(signal !== null);
    const responded = engine.respond({
      signal_id: signal.id,
      action_id: 'dismiss',
      responded_at: clock.now().toISOString(),
    });
    assert.equal(responded.muted_now, round === 2);
    clock.advanceMs(31 * 60_000);
  }

  assert.equal(engine.muteStateSnapshot().policies['nagging']?.muted, true);

  const afterMute = engine.evaluate(makeEvent({ id: 'evt-after' }));
  assert.equal(afterMute.decision, 'allow');
  assert.equal(afterMute.signal, null);
  assert.equal(afterMute.traces[0]?.status, 'muted');
});

test('approval resets the dismissal streak', () => {
  const policy = makePolicy({ id: 'reset-me' });
  const { engine, clock } = engineWith([policy]);

  const dismissOnce = () => {
    const outcome = engine.evaluate(makeEvent());
    assert.ok(outcome.signal !== null);
    engine.respond({ signal_id: outcome.signal.id, action_id: 'dismiss', responded_at: clock.now().toISOString() });
    clock.advanceMs(31 * 60_000);
  };

  dismissOnce();
  dismissOnce();

  const outcome = engine.evaluate(makeEvent());
  assert.ok(outcome.signal !== null);
  engine.respond({ signal_id: outcome.signal.id, action_id: 'approve', responded_at: clock.now().toISOString() });

  const state = engine.muteStateSnapshot().policies['reset-me'];
  assert.equal(state?.consecutive_dismissals, 0);
  assert.equal(state?.muted, false);
});

test('mute_1h suppresses the policy for an hour only', () => {
  const policy = makePolicy({ id: 'quiet-hour' });
  policy.presentation = {
    ...policy.presentation,
    actions: [
      { label: '好', action_id: 'approve' },
      { label: '静音 1 小时', action_id: 'mute_1h' },
    ],
  };
  const { engine, clock } = engineWith([policy]);

  const outcome = engine.evaluate(makeEvent());
  assert.ok(outcome.signal !== null);
  engine.respond({ signal_id: outcome.signal.id, action_id: 'mute_1h', responded_at: clock.now().toISOString() });

  // 59 minutes later: still muted.
  clock.advanceMs(59 * 60_000);
  assert.equal(engine.evaluate(makeEvent({ id: 'evt-mid' })).signal, null);

  // 61 minutes later: back.
  clock.advanceMs(2 * 60_000);
  assert.notEqual(engine.evaluate(makeEvent({ id: 'evt-back' })).signal, null);
});

test('re-presents at most once per escalation window', () => {
  const policy = makePolicy({
    id: 'windowed',
    priority: 10,
    escalation: { after_minutes: 10, action: 'remind_once', decision: 'suggest' },
  });
  const { engine, clock } = engineWith([policy]);

  const first = engine.evaluate(makeEvent({ id: 'evt-1' }));
  assert.equal(first.throttled, false);
  assert.ok(first.signal !== null);

  clock.advanceMs(5 * 60_000);
  const second = engine.evaluate(makeEvent({ id: 'evt-2' }));
  assert.equal(second.throttled, true);
  assert.equal(second.signal, null);
  assert.equal(second.decision, 'allow');

  const audit = engine.queryAudit({});
  assert.ok(audit.some((record) => record.reason === 'rate_limited'));
  assert.ok(audit.some((record) => record.reason === 'matched'));
});

test('responds reject unknown signals and actions that were not offered', () => {
  const policy = makePolicy({ id: 'strict' });
  const { engine } = engineWith([policy]);

  assert.throws(
    () => engine.respond({ signal_id: 'nope', action_id: 'approve', responded_at: NOW }),
    (error: unknown) => (error as { code?: string }).code === 'unknown_signal',
  );

  const outcome = engine.evaluate(makeEvent());
  assert.ok(outcome.signal !== null);
  const signalId = outcome.signal.id;
  assert.throws(
    () => engine.respond({ signal_id: signalId, action_id: 'mute_1h', responded_at: NOW }),
    (error: unknown) => (error as { code?: string }).code === 'invalid_action',
  );
});

test('every audit record carries the required fields and nothing else', () => {
  const policy = makePolicy({ id: 'audited' });
  const { engine, clock } = engineWith([policy]);

  const outcome = engine.evaluate(makeEvent({ id: 'evt-audit' }));
  assert.ok(outcome.signal !== null);
  engine.respond({ signal_id: outcome.signal.id, action_id: 'dismiss', responded_at: clock.now().toISOString() });

  const [matched, dismissed] = engine.queryAudit({});
  assert.ok(matched !== undefined && dismissed !== undefined);
  assert.deepEqual(Object.keys(matched).sort(), [
    'decision',
    'degraded',
    'engine_version',
    'event_id',
    'policy_id',
    'reason',
    'signal_id',
    'timestamp',
    'user_response',
  ]);
  assert.equal(matched.event_id, 'evt-audit');
  assert.equal(matched.policy_id, 'audited');
  assert.equal(matched.decision, 'suggest');
  assert.equal(matched.signal_id, outcome.signal.id);
  assert.equal(matched.user_response, null);
  assert.equal(dismissed.reason, 'user_dismissed');
  assert.equal(dismissed.user_response, 'dismiss');
  assert.equal(dismissed.decision, 'suggest');
});

test('pending exposes only unexpired signals', () => {
  const policy = makePolicy({
    id: 'short-lived',
    decision: 'suggest',
    action: { type: 'stretch_reminder', parameters: { duration_minutes: 5 } },
  });
  const { engine, clock } = engineWith([policy]);

  const outcome = engine.evaluate(makeEvent());
  assert.ok(outcome.signal !== null);
  assert.equal(engine.pending().length, 1);

  clock.advanceMs(6 * 60_000);
  assert.equal(engine.pending().length, 0);
});
