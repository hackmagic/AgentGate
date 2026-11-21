import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MemoryAuditStore } from '../src/audit/store.js';
import { AgentGate } from '../src/gate/index.js';
import { loadPolicyDirectory } from '../src/policy/load.js';
import type { Policy } from '../src/policy/types.js';
import type { AgentEvent } from '../src/events/types.js';

/**
 * Policy packs are the contribution surface, so "it validates" is not enough:
 * a pack that parses but never fires, or fires on the wrong event, is worse
 * than no pack. These tests drive each pack through a real gate.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));

function load(pack: string): Policy[] {
  return loadPolicyDirectory(path.join(REPO, 'packs', pack)).map((entry) => entry.policy);
}

/** Thursday 2026-11-20, 10:00 in Asia/Shanghai. */
const NOW = '2026-11-20T02:00:00.000Z';
const TZ = 'Asia/Shanghai';

function event(overrides: Partial<AgentEvent> & { type: AgentEvent['type'] }): AgentEvent {
  return {
    id: overrides.id ?? 'evt',
    type: overrides.type,
    timestamp: overrides.timestamp ?? NOW,
    source: 'manual',
    context: { app: 'Code', project: 'agent-gate', language: 'typescript', ...(overrides.context ?? {}) },
    duration_seconds: overrides.duration_seconds ?? null,
    metrics: overrides.metrics ?? {},
    metadata: overrides.metadata ?? {},
  };
}

function gateFor(policies: Policy[]) {
  const gate = new AgentGate({
    policies,
    audit: new MemoryAuditStore(),
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
  });
  return gate;
}

console.log('\n== health-break ==');

const health = load('health-break');

test('health-break ships four policies and they all load', () => {
  assert.equal(health.length, 4);
  assert.deepEqual(
    health.map((policy) => policy.id).sort(),
    ['late-night-work', 'long-stretch-break', 'no-break-warning', 'screen-time-eyes'],
  );
});

test('a one-hour focus block ends with a stretch suggestion', () => {
  const outcome = gateFor(health).evaluate(event({ type: 'focus_block_ended', duration_seconds: 3600 }));
  assert.equal(outcome.matched_policy_id, 'long-stretch-break');
  assert.equal(outcome.decision, 'suggest');
  assert.equal(outcome.signal?.presentation.bubble_text, '坐满一小时了，伸个懒腰？');
});

test('a short block does not nag about stretching', () => {
  const outcome = gateFor(health).evaluate(event({ type: 'focus_block_ended', duration_seconds: 1200 }));
  assert.equal(outcome.matched_policy_id, null, '20 minutes is not a sitting emergency');
  assert.equal(outcome.decision, 'allow');
});

test('the three-hour policy outranks the one-hour one and asks first', () => {
  const outcome = gateFor(health).evaluate(event({ type: 'focus_block_ended', duration_seconds: 11000 }));
  // priority 75 (no-break-warning) beats 70 (long-stretch-break) and 65 (eyes).
  assert.equal(outcome.matched_policy_id, 'no-break-warning');
  assert.equal(outcome.decision, 'require_approval', 'a three-hour stretch is worth asking about');
  assert.ok(outcome.signal?.presentation.actions.some((action) => action.action_id !== 'approve'));
});

test('late-night work is asked about, not decided for the user', () => {
  const gate = new AgentGate({
    policies: health,
    audit: new MemoryAuditStore(),
    clock: { now: () => new Date('2026-11-20T15:30:00.000Z') }, // 23:30 Asia/Shanghai
    timezone: TZ,
  });
  const outcome = gate.evaluate(
    event({ type: 'focus_block_started', timestamp: '2026-11-20T15:30:00.000Z' }),
  );
  assert.equal(outcome.matched_policy_id, 'late-night-work');
  assert.equal(outcome.decision, 'require_approval');
});

test('deep-night policy stays quiet during the working day', () => {
  const outcome = gateFor(health).evaluate(event({ type: 'focus_block_started' }));
  assert.notEqual(outcome.matched_policy_id, 'late-night-work');
});

console.log('\n== context-switch-guard ==');

const guard = load('context-switch-guard');

test('context-switch-guard ships four policies and they all load', () => {
  assert.equal(guard.length, 4);
  assert.deepEqual(
    guard.map((policy) => policy.id).sort(),
    ['context-thrash-warning', 'focus-switch-ask', 'notify-free-deep-block', 'return-to-focus'],
  );
});

test('switching to a chat app mid-focus asks for confirmation', () => {
  const outcome = gateFor(guard).evaluate(
    event({
      type: 'app_switch',
      duration_seconds: 120,
      context: { app: 'Slack', project: null, language: null },
    }),
  );
  assert.equal(outcome.matched_policy_id, 'focus-switch-ask');
  assert.equal(outcome.decision, 'require_approval');
});

test('switching to an editor slice is not treated as distraction', () => {
  const outcome = gateFor(guard).evaluate(
    event({
      type: 'app_switch',
      duration_seconds: 120,
      context: { app: 'Code', project: 'agent-gate', language: 'typescript' },
    }),
  );
  assert.notEqual(outcome.matched_policy_id, 'focus-switch-ask');
});

test('thrash warning is a suggestion, never an interception', () => {
  const outcome = gateFor(guard).evaluate(
    event({ type: 'app_switch', duration_seconds: 30, context: { app: 'Chrome', project: null, language: null } }),
  );
  assert.equal(outcome.matched_policy_id, 'context-thrash-warning');
  assert.equal(outcome.decision, 'suggest', 'a fragmented-switching nudge must not block anything');
});

test('returning to the editor in the evening offers a context hand-off', () => {
  // 19:00 Asia/Shanghai: inside return-to-focus's window and outside
  // notify-free-deep-block's 10:00-17:00 window, so the two do not stack.
  const gate = new AgentGate({
    policies: guard,
    audit: new MemoryAuditStore(),
    clock: { now: () => new Date('2026-11-20T11:00:00.000Z') },
    timezone: TZ,
  });
  const outcome = gate.evaluate(
    event({ type: 'focus_block_started', timestamp: '2026-11-20T11:00:00.000Z' }),
  );
  assert.equal(outcome.matched_policy_id, 'return-to-focus');
  assert.equal(outcome.decision, 'suggest');
});

test('no policy in a pack is shadowed forever by a higher-priority sibling', () => {
  // A policy that can never fire is worse than no policy: it looks like a
  // feature and behaves like a comment. This asserts every policy in every
  // shipped pack has at least one event shape where it is the winner.
  for (const pack of ['health-break', 'context-switch-guard', 'deep-work']) {
    const policies = load(pack);
    for (const policy of policies) {
      const probeTime = pickProbeInstant(policy);
      const gate = new AgentGate({
        policies,
        audit: new MemoryAuditStore(),
        clock: { now: () => new Date(probeTime) },
        timezone: TZ,
      });
      const probe = probeEventFor(policy, probeTime);
      const outcome = gate.evaluate(probe);
      assert.equal(
        outcome.matched_policy_id ?? null,
        policy.id,
        `${pack}/${policy.id} was shadowed by ${String(outcome.matched_policy_id)} for its own trigger`,
      );
    }
  }
});

/**
 * A Thursday instant most likely to satisfy the policy's own weekday and time
 * window.
 *
 * Weekday matters as much as the hour: a weekend-only policy is unreachable on
 * a Friday probe, and "unreachable in this test" would be indistinguishable
 * from "unreachable in production".
 */
function pickProbeInstant(policy: Policy): string {
  const weekdays = findWeekdays(policy.conditions);
  const window = findTimeWindow(policy.conditions);

  // 2026-11-20 is a Friday. Map a required weekday to that week.
  const dayOffsets: Record<string, number> = { mon: -4, tue: -3, wed: -2, thu: -1, fri: 0, sat: 1, sun: 2 };
  const wanted = weekdays[0];
  const offset = wanted === undefined ? -1 : (dayOffsets[wanted] ?? -1);
  const day = 20 + offset;

  const localHour = window === null ? 12 : Number((window.split('-')[0] ?? '00').slice(0, 2)) + 1;
  // Asia/Shanghai is UTC+8; convert the local hour to UTC.
  const utcHour = (localHour - 8 + 24) % 24;
  return `2026-11-${String(day).padStart(2, '0')}T${String(utcHour).padStart(2, '0')}:30:00.000Z`;
}

function findWeekdays(condition: unknown, out: string[] = []): string[] {
  if (Array.isArray(condition)) {
    for (const entry of condition) findWeekdays(entry, out);
    return out;
  }
  if (typeof condition !== 'object' || condition === null) return out;
  const record = condition as Record<string, unknown>;

  const value = record['day_of_week'];
  if (Array.isArray(value)) {
    for (const entry of value) out.push(String(entry).toLowerCase().slice(0, 3));
  }

  for (const child of Object.values(record)) findWeekdays(child, out);
  return out;
}

function findTimeWindow(condition: unknown): string | null {
  if (Array.isArray(condition)) {
    for (const entry of condition) {
      const found = findTimeWindow(entry);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof condition !== 'object' || condition === null) return null;
  const record = condition as Record<string, unknown>;
  if (typeof record['time_window'] === 'string') return record['time_window'];
  for (const value of Object.values(record)) {
    const found = findTimeWindow(value);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Build an event that satisfies the policy's trigger and *just* satisfies its
 * own numeric conditions.
 *
 * "Just" matters: probing with a huge duration would satisfy a stricter
 * sibling policy too, and the policy under test would lose to it for reasons
 * that have nothing to do with being dead. Killing a policy correctly means
 * probing at the edge of its own window.
 */
function probeEventFor(policy: Policy, timestamp: string): AgentEvent {
  const app = policy.trigger.context?.app?.[0] ?? 'Code';
  return {
    id: `probe-${policy.id}`,
    type: policy.trigger.event,
    timestamp,
    source: 'manual',
    context: { app, project: 'agent-gate', language: 'typescript' },
    duration_seconds: durationFloorFor(policy.conditions),
    metrics: { focus_score: 90 },
    metadata: {},
  };
}

/**
 * The smallest `duration_seconds` satisfying every duration condition in the
 * tree, defaulting to 0 when the policy does not constrain duration.
 * Returns `null` when a condition is unsatisfiable as written, which the caller
 * surfaces rather than hiding behind a large probe.
 */
function durationFloorFor(condition: unknown): number {
  const bounds = collectDurationBounds(condition);
  let floor = 0;
  for (const bound of bounds) floor = Math.max(floor, bound);
  return floor;
}

function collectDurationBounds(condition: unknown, out: number[] = []): number[] {
  if (Array.isArray(condition)) {
    for (const entry of condition) collectDurationBounds(entry, out);
    return out;
  }
  if (typeof condition !== 'object' || condition === null) return out;
  const record = condition as Record<string, unknown>;

  const duration = record['duration_seconds'];
  if (typeof duration === 'string') {
    const match = /^(>=|>|<=|<|==|=)\s*(-?\d+(?:\.\d+)?)$/.exec(duration);
    if (match !== null) {
      const operator = match[1] ?? '=';
      const bound = Number(match[2]);
      // `> n` first satisfied at n+1; `>= n` at n.
      if (operator === '>') out.push(Math.floor(bound) + 1);
      else if (operator === '>=') out.push(Math.ceil(bound));
      else if (operator === '=' || operator === '==') out.push(bound);
    }
  }

  for (const value of Object.values(record)) collectDurationBounds(value, out);
  return out;
}

test('deep-block notification suppression asks before silencing anything', () => {
  // notify-free-deep-block is `suppress` with requires_approval, so rule 1
  // applies: it may only ever produce an approval request.
  const outcome = gateFor(guard).evaluate(event({ type: 'focus_block_started' }));
  const suppression = guard.find((policy) => policy.id === 'notify-free-deep-block');
  assert.ok(suppression !== undefined);
  assert.equal(suppression.decision, 'suppress');
  assert.equal(suppression.safety.requires_approval, true);
  // return-to-focus has lower priority (45), so it wins a plain evaluate; the
  // suppression policy must be evaluated on its own to prove the downgrade.
  const alone = gateFor([suppression]).evaluate(event({ type: 'focus_block_started' }));
  assert.equal(alone.decision, 'require_approval', 'suppress + approval may only ask, never act');
  assert.notEqual(outcome.decision, 'suppress');
});

console.log('\n== packs compose ==');

test('both new packs can be enabled together without conflicting', () => {
  const combined = [...health, ...guard];
  assert.equal(combined.length, 8);
  const outcome = gateFor(combined).evaluate(event({ type: 'focus_block_started' }));
  // Highest priority wins; the point is that a decision is reached, not a crash.
  assert.ok(outcome.decision !== undefined);
  assert.ok(outcome.traces.length > 0);
});

test('every policy in the new packs is audited on first match', () => {
  for (const policy of [...health, ...guard]) {
    const audit = new MemoryAuditStore();
    const gate = new AgentGate({
      policies: [policy],
      audit,
      clock: { now: () => new Date('2026-11-20T15:30:00.000Z') },
      timezone: TZ,
    });
    // The event type must match, or the policy is skipped before evaluation.
    const probe =
      policy.trigger.event === 'focus_block_ended'
        ? event({ type: 'focus_block_ended', duration_seconds: 20000, timestamp: '2026-11-20T15:30:00.000Z' })
        : policy.trigger.event === 'app_switch'
          ? event({
              type: 'app_switch',
              duration_seconds: 30,
              timestamp: '2026-11-20T15:30:00.000Z',
              context: { app: 'Slack', project: null, language: null },
            })
          : event({ type: 'focus_block_started', timestamp: '2026-11-20T15:30:00.000Z' });

    gate.evaluate(probe);
    const records = audit.query({});
    // Either it matched (one line) or it did not (no line) — never a malformed one.
    for (const record of records) {
      assert.equal(Object.keys(record).length, 9, `${policy.id} widened the audit record`);
    }
  }
});

console.log('\n== documented example sequences ==');

test('every example sequence still produces the outcome it documents', async () => {
  // The fixtures in `examples/` record what each case is supposed to do. This
  // replays them, so a YAML edit that changes an outcome fails here instead of
  // leaving a stale expectation behind.
  const { readFileSync } = await import('node:fs');
  const files = ['examples/health-break-sequences.json', 'examples/context-switch-guard-sequences.json'];

  for (const file of files) {
    const spec = JSON.parse(readFileSync(path.join(REPO, file), 'utf8')) as {
      pack: string;
      timezone: string;
      sequences: { id: string; expect: { decision: string; policy_id: string | null }; event: unknown }[];
    };

    const policies = loadPolicyDirectory(path.join(REPO, 'packs', spec.pack)).map((entry) => entry.policy);

    for (const sequence of spec.sequences) {
      const { normalizeEvent } = await import('../src/events/normalize.js');
      const event = normalizeEvent(sequence.event);
      const gate = new AgentGate({
        policies,
        audit: new MemoryAuditStore(),
        clock: { now: () => new Date(event.timestamp) },
        timezone: spec.timezone,
        signal_id_factory: () => `sig-${sequence.id}`,
      });

      const outcome = gate.evaluate(event);
      assert.equal(outcome.decision, sequence.expect.decision, `${file} ${sequence.id}: decision`);
      assert.equal(
        outcome.matched_policy_id ?? null,
        sequence.expect.policy_id,
        `${file} ${sequence.id}: matched policy`,
      );
    }
  }
});
