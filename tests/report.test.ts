import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAuditStore } from '../src/audit/store.js';
import { AgentGate } from '../src/gate/index.js';
import { buildReport, FINDING_CODES } from '../src/report/build.js';
import { renderJson, renderText } from '../src/report/render.js';
import { makeEvent, makePolicy, NOW, TZ } from './helpers.js';

/**
 * The report is a projection of the audit log, so these tests build real logs
 * through a real gate rather than hand-writing records. A hand-written record
 * would pass even if the engine never emitted that reason — which is exactly
 * the bug this suite was written to catch.
 */

function newGate(policies = [makePolicy({ id: 'focus-guard' })]) {
  const audit = new MemoryAuditStore();
  let now = new Date(NOW);
  const gate = new AgentGate({
    policies,
    audit,
    clock: { now: () => now },
    timezone: TZ,
    signal_id_factory: (() => {
      let counter = 0;
      return () => `sig-${(counter += 1)}`;
    })(),
  });
  return {
    gate,
    audit,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    at() {
      return now;
    },
  };
}

/** Present once and answer; advances past any presentation window. */
function answer(harness: ReturnType<typeof newGate>, action: 'approve' | 'dismiss' | 'mute_1h', eventId: string) {
  const outcome = harness.gate.evaluate(makeEvent({ id: eventId }));
  if (outcome.signal !== null) {
    harness.gate.respond({
      signal_id: outcome.signal.id,
      action_id: action,
      responded_at: harness.at().toISOString(),
    });
  }
  return outcome;
}

test('an empty log still produces a usable report', () => {
  const harness = newGate();
  const report = buildReport([makePolicy({ id: 'p' })], harness.audit.query(), { now: new Date(NOW) });

  assert.equal(report.window, null);
  assert.equal(report.summary.events, 0);
  assert.equal(report.summary.policies, 1);
  assert.equal(report.summary.policies_seen, 0);
  assert.equal(report.summary.approval_rate, null, 'no answers is not a 0% approval rate');
  assert.equal(report.lifecycle.validated, 1);
  assert.deepEqual(report.findings, []);
});

test('counts follow the actions the user actually took', () => {
  const harness = newGate();
  answer(harness, 'approve', 'e1');
  harness.advance(31 * 60_000);
  answer(harness, 'dismiss', 'e2');
  harness.advance(31 * 60_000);
  answer(harness, 'dismiss', 'e3');

  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
  });
  const policy = report.policies[0];

  assert.equal(policy?.presented, 3);
  assert.equal(policy?.approved, 1);
  assert.equal(policy?.dismissed, 2);
  assert.equal(report.summary.events, 3);
  assert.equal(report.summary.approval_rate, 0.333);
});

test('crossing the dismissal threshold writes a `muted` line and the projection sees it', () => {
  // Regression: the engine used to write only `user_dismissed`, so a muted
  // policy was projected as `active` while the engine held it as muted. The
  // `muted` reason existed in AUDIT_REASONS and in lifecycle.ts, and nothing
  // ever emitted it.
  const harness = newGate();
  for (let round = 1; round <= 3; round += 1) {
    answer(harness, 'dismiss', `e${round}`);
    harness.advance(31 * 60_000);
  }

  const reasons = harness.audit.query({}).map((record) => record.reason);
  assert.ok(reasons.includes('muted'), `expected a muted reason, saw: ${reasons.join(',')}`);

  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
  });
  assert.equal(
    report.policies[0]?.state,
    'muted',
    'the projection must agree with the engine about being muted',
  );
  assert.equal(report.lifecycle.muted, 1);
  assert.ok(report.findings.some((finding) => finding.code === 'muted'));
});

test('a bounded mute_1h is reported with its expiry and ends on its own', () => {
  const policy = makePolicy({ id: 'quiet-hour' });
  policy.presentation = {
    ...policy.presentation,
    actions: [
      { label: '好', action_id: 'approve' },
      { label: '静音 1 小时', action_id: 'mute_1h' },
    ],
  };
  const harness = newGate([policy]);

  answer(harness, 'mute_1h', 'e1');
  const during = buildReport([policy], harness.audit.query(), { now: new Date(harness.at()) });
  assert.equal(during.policies[0]?.state, 'muted');
  assert.ok(during.policies[0]?.muted_until !== null);

  harness.advance(61 * 60_000);
  const after = buildReport([policy], harness.audit.query(), { now: new Date(harness.at()) });
  assert.equal(after.policies[0]?.state, 'active', 'the clock alone ends a bounded mute');
});

test('throttling is visible per policy, not hidden in a total', () => {
  const harness = newGate();
  // Presentation window defaults to 30 minutes; evaluate twice inside it.
  answer(harness, 'approve', 'e1');
  const throttled = harness.gate.evaluate(makeEvent({ id: 'e2' }));
  assert.equal(throttled.throttled, true);

  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
  });
  assert.equal(report.policies[0]?.throttled, 1);
  assert.equal(report.summary.throttled, 1);
});

test('a high rejection rate is reported with the numbers behind it', () => {
  const harness = newGate();
  answer(harness, 'dismiss', 'e1');
  harness.advance(31 * 60_000);
  answer(harness, 'dismiss', 'e2');

  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
  });
  const finding = report.findings.find((entry) => entry.code === 'high_rejection_rate');
  assert.ok(finding !== undefined);
  assert.equal(finding.policy_id, 'focus-guard');
  assert.match(finding.message, /2 of 2/);
});

test('a policy that never reaches the user is flagged', () => {
  const harness = newGate();
  answer(harness, 'approve', 'e1');
  // Inside the window: a match that is entirely suppressed.
  harness.gate.evaluate(makeEvent({ id: 'e2' }));

  const lonely = makePolicy({ id: 'never-shown', trigger: { event: 'idle_detected' } });
  const report = buildReport([makePolicy({ id: 'focus-guard' }), lonely], harness.audit.query(), {
    now: new Date(harness.at()),
  });

  assert.equal(report.summary.policies_seen, 1, 'a policy with no records was never seen');
  assert.equal(report.summary.policies, 2);
});

test('a degraded evaluation is counted in the summary even when unattributable', () => {
  // The engine writes `policy_id: 'none'` for a degraded run: when a policy
  // throws, attributing the line to it would mean trusting the code that just
  // failed. The summary must still count it; the per-policy column must not
  // invent an owner.
  const audit = new MemoryAuditStore();
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'broken', conditions: { time_window: '09:00-12:00' } })],
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: 'Mars/Olympus',
  });
  gate.evaluate(makeEvent());

  const report = buildReport([makePolicy({ id: 'broken' })], audit.query(), { now: new Date(NOW) });
  assert.equal(report.summary.degraded, 1, 'the global count must see the degraded line');
  assert.equal(report.policies[0]?.degraded, 0, 'no policy is blamed without evidence');
  assert.equal(report.policies[0]?.first_seen, null, 'the policy itself has no records');
});

test('every finding code the report can emit is a declared code', () => {
  const harness = newGate();
  answer(harness, 'dismiss', 'e1');
  harness.advance(31 * 60_000);
  answer(harness, 'dismiss', 'e2');

  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
  });
  for (const finding of report.findings) {
    assert.ok(
      (FINDING_CODES as readonly string[]).includes(finding.code),
      `${finding.code} is not declared in FINDING_CODES, so docs/10 cannot document it`,
    );
  }
});

test('the two renderings agree and json round-trips', () => {
  const harness = newGate();
  answer(harness, 'approve', 'e1');
  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
  });

  const parsed = JSON.parse(renderJson(report)) as typeof report;
  assert.deepEqual(parsed, report);

  const text = renderText(report);
  assert.match(text, /Summary/);
  assert.match(text, /Lifecycle/);
  assert.match(text, /focus-guard/);
  assert.match(text, /100%/);

  // The human view must not invent a rate where none can be computed.
  const empty = buildReport([], [], { now: new Date(NOW) });
  assert.match(renderText(empty), /approval rate {3}n\/a/);
});

test('the policies table can be suppressed without losing the summary', () => {
  const harness = newGate();
  answer(harness, 'approve', 'e1');
  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
  });

  const text = renderText(report, { include_policies: false });
  assert.match(text, /Summary/);
  assert.equal(text.includes('focus-guard'), false);
});

test('archiving via the report renders the archived state', () => {
  const harness = newGate();
  answer(harness, 'approve', 'e1');
  const report = buildReport([makePolicy({ id: 'focus-guard' })], harness.audit.query(), {
    now: new Date(harness.at()),
    archives: [{ policy_id: 'focus-guard', reason: 'superseded', at: NOW }],
  });
  assert.equal(report.policies[0]?.state, 'archived');
  assert.equal(report.lifecycle.archived, 1);
});
