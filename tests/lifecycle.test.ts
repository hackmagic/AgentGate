import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuditRecord, type AuditRecord } from '../src/audit/store.js';
import { authoringState, projectLifecycle } from '../src/policy/lifecycle.js';
import { makePolicy, NOW } from './helpers.js';

const POLICY = makePolicy({ id: 'focus-guard' });

function record(reason: AuditRecord['reason'], at: string, overrides: Partial<AuditRecord> = {}): AuditRecord {
  return createAuditRecord({
    event_id: 'evt',
    policy_id: 'focus-guard',
    decision: 'suggest',
    signal_id: null,
    user_response: null,
    timestamp: at,
    engine_version: '0.1.0',
    degraded: false,
    reason,
    ...overrides,
  });
}

test('a policy with no history is validated, never guessed active', () => {
  const [entry] = projectLifecycle([POLICY], [], new Date(NOW));
  assert.equal(entry?.state, 'validated');
  assert.equal(entry?.since, null);
  assert.deepEqual(entry?.transitions, []);
});

test('being presented moves a policy from validated to active', () => {
  const [entry] = projectLifecycle([POLICY], [record('matched', NOW)], new Date(NOW));
  assert.equal(entry?.state, 'active');
  assert.equal(entry?.since, NOW);
  assert.deepEqual(
    entry?.transitions.map((transition) => `${transition.from}→${transition.to}`),
    ['validated→active'],
  );
});

test('three dismissals are counted but do not mute on their own', () => {
  const audit = [
    record('matched', NOW),
    record('user_dismissed', '2026-11-20T02:00:00.000Z'),
    record('user_dismissed', '2026-11-20T03:00:00.000Z'),
    record('user_dismissed', '2026-11-20T04:00:00.000Z'),
  ];
  const [entry] = projectLifecycle([POLICY], audit, new Date('2026-11-20T05:00:00.000Z'));

  assert.equal(entry?.consecutive_dismissals, 3);
  // The engine only mutes via the audit reason `muted` after its own threshold.
  assert.equal(entry?.state, 'active');
});

test('an approval clears the dismissal streak', () => {
  const audit = [
    record('matched', NOW),
    record('user_dismissed', '2026-11-20T02:00:00.000Z'),
    record('user_dismissed', '2026-11-20T03:00:00.000Z'),
    record('user_approved', '2026-11-20T04:00:00.000Z'),
  ];
  const [entry] = projectLifecycle([POLICY], audit, new Date('2026-11-20T05:00:00.000Z'));
  assert.equal(entry?.consecutive_dismissals, 0);
});

test('mute_1h opens a bounded window that the clock closes by itself', () => {
  const mutedAt = '2026-11-20T02:00:00.000Z';
  const audit = [record('matched', NOW), record('user_muted', mutedAt)];

  const during = projectLifecycle([POLICY], audit, new Date('2026-11-20T02:30:00.000Z'))[0];
  assert.equal(during?.state, 'muted');
  assert.equal(during?.muted_until, '2026-11-20T03:00:00.000Z');

  const after = projectLifecycle([POLICY], audit, new Date('2026-11-20T03:30:00.000Z'))[0];
  assert.equal(after?.state, 'active');
  assert.equal(after?.muted_until, null);
  assert.equal(
    after?.transitions.at(-1)?.reason,
    'mute_window_elapsed',
    'the clock alone ends a bounded mute, without a fresh audit line',
  );
});

test('an unbounded mute from the threshold stays muted', () => {
  const audit = [record('matched', NOW), record('muted', '2026-11-20T02:00:00.000Z')];
  const [entry] = projectLifecycle([POLICY], audit, new Date('2030-01-01T00:00:00.000Z'));
  assert.equal(entry?.state, 'muted');
  assert.equal(entry?.muted_until, null);
});

test('mute_1h never changes the dismissal count (rule 5)', () => {
  const audit = [
    record('matched', NOW),
    record('user_dismissed', '2026-11-20T01:30:00.000Z'),
    record('user_muted', '2026-11-20T02:00:00.000Z'),
  ];
  const [entry] = projectLifecycle([POLICY], audit, new Date('2026-11-20T02:30:00.000Z'));
  assert.equal(entry?.consecutive_dismissals, 1);
});

test('an archive request wins over runtime state and records why', () => {
  const audit = [record('matched', NOW), record('user_muted', '2026-11-20T02:00:00.000Z')];
  const [entry] = projectLifecycle([POLICY], audit, new Date('2026-11-20T02:30:00.000Z'), {
    archives: [{ policy_id: 'focus-guard', reason: 'superseded', at: '2026-11-20T09:00:00.000Z' }],
  });

  assert.equal(entry?.state, 'archived');
  assert.equal(entry?.consecutive_dismissals, 0);
  assert.equal(entry?.muted_until, null);
  assert.equal(entry?.transitions.at(-1)?.reason, 'archived:superseded');
});

test('the lifecycle transition list tells the whole story in order', () => {
  const audit = [
    record('matched', NOW),
    record('user_muted', '2026-11-20T02:00:00.000Z'),
  ];
  const [entry] = projectLifecycle([POLICY], audit, new Date('2026-11-20T04:00:00.000Z'));

  assert.deepEqual(
    entry?.transitions.map((transition) => `${transition.from}→${transition.to}@${transition.at}`),
    [
      'validated→active@2026-11-20T01:00:00.000Z',
      'active→muted@2026-11-20T02:00:00.000Z',
      'muted→active@2026-11-20T03:00:00.000Z',
    ],
  );
});

test('invalid authoring state can never be activated', () => {
  assert.equal(authoringState(true), 'validated');
  assert.equal(authoringState(false), 'draft');
});

test('projection is pure: it does not reorder or mutate the audit input', () => {
  const audit = [record('user_dismissed', '2026-11-20T03:00:00.000Z'), record('matched', NOW)];
  const snapshot = audit.map((entry) => ({ ...entry }));
  projectLifecycle([POLICY], audit, new Date(NOW));
  assert.deepEqual(audit, snapshot);
});
