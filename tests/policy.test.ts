import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateConditions } from '../src/policy/conditions.js';
import { validatePolicyDocument } from '../src/policy/validate.js';
import { makeEvent, makePolicy, NOW, TZ } from './helpers.js';

function codes(input: unknown): string[] {
  return validatePolicyDocument(input).issues.map((issue) => issue.code);
}

test('accepts a canonical document and a bare policy body', () => {
  const policy = makePolicy({ id: 'focus-stretch' });

  const wrapped = validatePolicyDocument({ policy });
  assert.equal(wrapped.valid, true);
  assert.equal(wrapped.policy?.id, 'focus-stretch');

  const bare = validatePolicyDocument(policy);
  assert.equal(bare.valid, true);
  assert.equal(bare.policy?.id, 'focus-stretch');
});

test('rejects an unknown top-level property', () => {
  const policy = { ...makePolicy({ id: 'unknown-prop' }), surprise: true };
  const result = validatePolicyDocument(policy);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'additionalProperties'));
});

test('rule: a policy that may act without approval needs a rationale', () => {
  const policy = makePolicy({ id: 'no-rationale' });
  policy.safety = { requires_approval: false, reversible: true, audit_level: 'summary' };

  const result = validatePolicyDocument(policy);
  assert.equal(result.valid, false);
  assert.deepEqual(codes(policy), ['missing_rationale']);
  assert.match(result.issues[0]?.path ?? '', /^\/policy\/safety\/rationale$/);
});

test('rule: unaudited autonomy is rejected', () => {
  const policy = makePolicy({ id: 'unaudited' });
  policy.safety = {
    requires_approval: false,
    rationale: 'it is fine, trust me',
    reversible: true,
    audit_level: 'none',
  };

  assert.deepEqual(codes(policy), ['unaudited_autonomy']);
});

test('rule: require_approval contradicts requires_approval: false', () => {
  const policy = makePolicy({
    id: 'contradiction',
    decision: 'require_approval',
    action: { type: 'suppress_notifications', scope: ['slack'] },
  });

  const result = validatePolicyDocument(policy);
  assert.equal(result.valid, false);
  assert.deepEqual(codes(policy), ['approval_contradiction']);
  assert.match(result.issues[0]?.message ?? '', /require_approval/);
});

test('rule: suppress and require_approval must say what would happen', () => {
  const policy = makePolicy({ id: 'no-action', decision: 'suppress', safety: { ...makePolicy({ id: 'x' }).safety, requires_approval: true } });
  assert.deepEqual(codes(policy), ['missing_action']);
});

test('rule: allow must not carry an action', () => {
  const policy = makePolicy({ id: 'allow-with-action', decision: 'allow', action: { type: 'mute_notifications' } });
  assert.deepEqual(codes(policy), ['allow_with_action']);
});

test('bubble_text is capped at 30 characters, counting CJK as one', () => {
  const policy = makePolicy({ id: 'long-bubble' });
  policy.presentation = { ...policy.presentation, bubble_text: '这'.repeat(31) };

  assert.deepEqual(codes(policy), ['bubble_too_long']);

  const ok = makePolicy({ id: 'exact-bubble' });
  ok.presentation = { ...ok.presentation, bubble_text: '这'.repeat(30) };
  assert.equal(validatePolicyDocument(ok).valid, true);
});

test('duplicate action ids are rejected', () => {
  const policy = makePolicy({ id: 'dup-actions' });
  policy.presentation = {
    ...policy.presentation,
    actions: [
      { label: '好', action_id: 'approve' },
      { label: '再点一次', action_id: 'approve' },
    ],
  };

  assert.deepEqual(codes(policy), ['duplicate_action']);
});

test('duration_minutes must be positive', () => {
  const policy = makePolicy({
    id: 'bad-duration',
    decision: 'suggest',
    action: { type: 'stretch_reminder', parameters: { duration_minutes: 0 } },
  });

  assert.deepEqual(codes(policy), ['invalid_duration']);
});

test('time_window is inclusive of start, exclusive of end, in local time', () => {
  const event = makeEvent();
  const inside = evaluateConditions({ time_window: '09:00-12:00' }, { event, now: new Date(NOW), timezone: TZ });
  assert.equal(inside.matched, true);

  // 03:30 UTC is 11:30 in Shanghai.
  const late = evaluateConditions(
    { time_window: '09:00-12:00' },
    { event, now: new Date('2026-11-20T03:30:00.000Z'), timezone: TZ },
  );
  assert.equal(late.matched, true);

  // 04:30 UTC is 12:30 in Shanghai — outside the half-open window.
  const after = evaluateConditions(
    { time_window: '09:00-12:00' },
    { event, now: new Date('2026-11-20T04:30:00.000Z'), timezone: TZ },
  );
  assert.equal(after.matched, false);
});

test('time_window may cross midnight', () => {
  const event = makeEvent();
  // 15:00 UTC is 23:00 in Shanghai.
  const night = evaluateConditions(
    { time_window: '22:00-06:00' },
    { event, now: new Date('2026-11-20T15:00:00.000Z'), timezone: TZ },
  );
  assert.equal(night.matched, true);

  // 05:00 UTC is 13:00 in Shanghai.
  const noon = evaluateConditions(
    { time_window: '22:00-06:00' },
    { event, now: new Date('2026-11-20T05:00:00.000Z'), timezone: TZ },
  );
  assert.equal(noon.matched, false);
});

test('day_of_week matches the local weekday', () => {
  const friday = makeEvent();
  assert.equal(
    evaluateConditions({ day_of_week: ['mon', 'fri'] }, { event: friday, now: new Date(NOW), timezone: TZ }).matched,
    true,
  );
  assert.equal(
    evaluateConditions({ day_of_week: ['sat', 'sun'] }, { event: friday, now: new Date(NOW), timezone: TZ }).matched,
    false,
  );
});

test('all/any/not compose, and numeric comparisons read metrics first', () => {
  const event = makeEvent({ metrics: { focus_score: 82 }, duration_seconds: 1800 });
  const options = { event, now: new Date(NOW), timezone: TZ };

  assert.equal(
    evaluateConditions(
      { all: [{ app: ['code'] }, { focus_score: '> 70' }, { duration_seconds: '>= 1500' }] },
      options,
    ).matched,
    true,
  );
  assert.equal(evaluateConditions({ all: [{ focus_score: '> 90' }] }, options).matched, false);
  assert.equal(evaluateConditions({ any: [{ focus_score: '> 90' }, { app: ['code'] }] }, options).matched, true);
  assert.equal(evaluateConditions({ not: { app: ['code'] } }, options).matched, false);
});

test('an unknown condition field never matches and explains why', () => {
  const event = makeEvent();
  const result = evaluateConditions({ battery_level: '> 10' }, { event, now: new Date(NOW), timezone: TZ });

  assert.equal(result.matched, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? '', /battery_level/);
});

test('app matching is case-insensitive', () => {
  const event = makeEvent({ context: { app: 'Code', project: null, language: null } });
  const result = evaluateConditions({ app: ['CODE'] }, { event, now: new Date(NOW), timezone: TZ });
  assert.equal(result.matched, true);
});

test('an unknown timezone is a hard error, not a silent no-match', () => {
  const event = makeEvent();
  assert.throws(
    () => evaluateConditions({ time_window: '09:00-12:00' }, { event, now: new Date(NOW), timezone: 'Mars/Olympus' }),
    /time zone/i,
  );
});
