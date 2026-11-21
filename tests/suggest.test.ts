import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAuditStore } from '../src/audit/store.js';
import { AUDIT_FIELD_WHITELIST, createAuditRecord, type AuditRecord } from '../src/audit/store.js';
import { AgentGate } from '../src/gate/index.js';
import { buildReport } from '../src/report/build.js';
import { suggestRevisions } from '../src/report/suggest.js';
import { renderMarkdown, renderText } from '../src/report/render.js';
import { makeEvent, makePolicy, NOW, TZ } from './helpers.js';
import type { Policy } from '../src/policy/types.js';

/**
 * Revision suggestions must be **falsifiable**, and that constrains what they
 * may claim.
 *
 * The audit whitelist has no event context and no trigger conditions, so the
 * only defensible signal is *when* dismissals happen. These tests exist mostly
 * to hold that line: a suggestion that quietly used data it does not have
 * would read well and be wrong.
 */

const TZONE = TZ;

function policyWithWindow(id: string, window: string | null): Policy {
  const base = makePolicy({ id });
  if (window === null) return base;
  return { ...base, conditions: { all: [{ time_window: window }] } };
}

/** Build a `user_dismissed` record at a local time. */
function dismissedAt(policyId: string, localHour: number, day = 16): AuditRecord {
  // Asia/Shanghai is UTC+8.
  const utcHour = (localHour - 8 + 24) % 24;
  const dayOffset = localHour < 8 ? 1 : 0;
  const timestamp = `2026-11-${String(day + dayOffset).padStart(2, '0')}T${String(utcHour).padStart(2, '0')}:15:00.000Z`;
  return createAuditRecord({
    event_id: `e-${policyId}-${day}-${localHour}`,
    policy_id: policyId,
    decision: 'suggest',
    signal_id: 'sig',
    user_response: 'dismiss',
    timestamp,
    engine_version: '0.7.0',
    degraded: false,
    reason: 'user_dismissed',
  });
}

function approvedAt(policyId: string, localHour: number, day = 16): AuditRecord {
  const utcHour = (localHour - 8 + 24) % 24;
  const timestamp = `2026-11-${String(day).padStart(2, '0')}T${String(utcHour).padStart(2, '0')}:15:00.000Z`;
  return createAuditRecord({
    event_id: `a-${policyId}-${day}-${localHour}`,
    policy_id: policyId,
    decision: 'require_approval',
    signal_id: 'sig',
    user_response: 'approve',
    timestamp,
    engine_version: '0.7.0',
    degraded: false,
    reason: 'user_approved',
  });
}

console.log('\n== the evidence boundary ==');

test('the audit whitelist really has no event context or conditions', () => {
  // This is the premise of every suggestion. If it ever changes, the
  // suggestions could say more — and this test is where that would surface.
  const fields = new Set<string>(AUDIT_FIELD_WHITELIST);
  for (const forbidden of ['context', 'app', 'project', 'conditions', 'trigger', 'metadata', 'window_title']) {
    assert.equal(fields.has(forbidden), false, `the whitelist must not carry "${forbidden}"`);
  }
});

test('no suggestion is made without enough dismissals', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [dismissedAt('p', 10), dismissedAt('p', 10, 17)];
  assert.deepEqual(suggestRevisions([policy], audit, { timezone: TZONE }), []);
});

test('a suggestion is made when dismissals cluster, and it narrows the window', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [dismissedAt('p', 10, 16), dismissedAt('p', 10, 17), dismissedAt('p', 11, 18)];

  const [suggestion] = suggestRevisions([policy], audit, { timezone: TZONE });
  assert.ok(suggestion !== undefined);
  assert.equal(suggestion.policy_id, 'p');
  assert.equal(suggestion.kind, 'narrow_time_window');
  assert.equal(suggestion.proposed_change?.field, 'time_window');
  assert.equal(suggestion.proposed_change?.from, '09:00-12:00');
  assert.match(suggestion.proposed_change?.to ?? '', /^1[01]:00-12:00$/);
  assert.ok(suggestion.evidence.concentration >= 0.6, 'the proposed window must actually hold the dismissals');
});

test('scattered dismissals produce no suggestion, because there is no window to narrow', () => {
  // Dismissals at 03:00, 10:00, 15:00, 21:00: no clustering, so the honest
  // answer is "no time-based fix exists", not a made-up window.
  const policy = policyWithWindow('p', '00:00-23:59');
  const audit = [
    dismissedAt('p', 3, 16),
    dismissedAt('p', 10, 17),
    dismissedAt('p', 15, 18),
    dismissedAt('p', 21, 19),
  ];

  const suggestions = suggestRevisions([policy], audit, { timezone: TZONE, min_bucket_share: 0.6 });
  assert.deepEqual(suggestions, [], 'a scattered pattern must not be narrowed into a fabricated window');
});

test('a policy without a time_window gets evidence but no invented fix', () => {
  const policy = policyWithWindow('p', null);
  const audit = [dismissedAt('p', 10, 16), dismissedAt('p', 10, 17), dismissedAt('p', 11, 18)];

  const [suggestion] = suggestRevisions([policy], audit, { timezone: TZONE });
  assert.ok(suggestion !== undefined);
  assert.equal(suggestion.proposed_change, null, 'there is no window to narrow, so no change is proposed');
  assert.ok(
    suggestion.caveats.some((caveat) => caveat.includes('no `time_window`')),
    'the caveat must say why no fix is offered',
  );
});

test('every suggestion carries caveats naming its limits', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [dismissedAt('p', 10, 16), dismissedAt('p', 10, 17), dismissedAt('p', 11, 18)];

  const [suggestion] = suggestRevisions([policy], audit, { timezone: TZONE });
  assert.ok(suggestion !== undefined);
  assert.ok(suggestion.caveats.length >= 2);
  // The most important one: we know when, not why.
  assert.ok(
    suggestion.caveats.some((caveat) => caveat.includes('not why')),
    'the caveat must state that the log records when, not why',
  );
  // A small sample must be called small.
  assert.ok(suggestion.caveats.some((caveat) => caveat.includes('small sample')));
});

test('a large sample does not carry the small-sample caveat', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = Array.from({ length: 8 }, (_, index) => dismissedAt('p', 10, 10 + index));

  const [suggestion] = suggestRevisions([policy], audit, { timezone: TZONE });
  assert.ok(suggestion !== undefined);
  assert.equal(
    suggestion.caveats.some((caveat) => caveat.includes('small sample')),
    false,
    'a caveat that always appears stops being read',
  );
});

test('approvals in the same window are counted, so the rate is visible', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [
    dismissedAt('p', 10, 16),
    dismissedAt('p', 10, 17),
    dismissedAt('p', 11, 18),
    approvedAt('p', 10, 19),
  ];

  const [suggestion] = suggestRevisions([policy], audit, { timezone: TZONE });
  assert.ok(suggestion !== undefined);
  assert.equal(suggestion.evidence.dismissals, 3);
  assert.equal(suggestion.evidence.approvals, 1);
  assert.match(suggestion.summary, /3 of 4/);
});

test('suggestions are deterministic and independent of run time', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [dismissedAt('p', 10, 16), dismissedAt('p', 10, 17), dismissedAt('p', 11, 18)];

  const first = suggestRevisions([policy], audit, { timezone: TZONE, now: new Date('2026-11-20T00:00:00Z') });
  const second = suggestRevisions([policy], audit, { timezone: TZONE, now: new Date('2026-12-01T00:00:00Z') });
  assert.deepEqual(first, second, 'buckets are anchored to the clock hour, not to the run');
});

console.log('\n== wired into the report ==');

test('the report carries suggestions separately from findings', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [dismissedAt('p', 10, 16), dismissedAt('p', 10, 17), dismissedAt('p', 11, 18)];

  const report = buildReport([policy], audit, { now: new Date(NOW), timezone: TZONE });
  assert.equal(report.suggestions.length, 1);
  // A finding says something is wrong; a suggestion says what to change.
  assert.ok(report.findings.some((finding) => finding.code === 'high_rejection_rate'));
  assert.equal(report.suggestions[0]?.kind, 'narrow_time_window');
});

test('markdown renders the proposal as an applicable diff', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [dismissedAt('p', 10, 16), dismissedAt('p', 10, 17), dismissedAt('p', 11, 18)];

  const report = buildReport([policy], audit, { now: new Date(NOW), timezone: TZONE });
  const markdown = renderMarkdown(report);

  assert.match(markdown, /^## Suggestions$/m);
  assert.match(markdown, /time_window: "1[01]:00-12:00"\s+# was: 09:00-12:00/);
  assert.match(markdown, /Caveats:/);
});

test('text rendering shows the suggestion without claiming certainty', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const audit = [dismissedAt('p', 10, 16), dismissedAt('p', 10, 17), dismissedAt('p', 11, 18)];

  const text = renderText(buildReport([policy], audit, { now: new Date(NOW), timezone: TZONE }));
  assert.match(text, /Suggestions/);
  assert.match(text, /time_window: 09:00-12:00 -> /);
});

test('a report with no suggestions renders no Suggestions section', () => {
  const policy = policyWithWindow('p', '09:00-12:00');
  const report = buildReport([policy], [], { now: new Date(NOW), timezone: TZONE });
  assert.deepEqual(report.suggestions, []);
  assert.equal(renderMarkdown(report).includes('## Suggestions'), false);
  assert.equal(renderText(report).includes('Suggestions'), false);
});

console.log('\n== end to end through a real gate ==');

test('three real dismissals in one hour produce a suggestion naming that hour', () => {
  // Drives the actual engine, so this also proves the write path records what
  // the suggester reads.
  const policy = policyWithWindow('focus-guard', '09:00-12:00');
  const audit = new MemoryAuditStore();

  for (let round = 0; round < 3; round += 1) {
    // 10:05 Asia/Shanghai is 02:05 UTC; spread over three days.
    const iso = `2026-11-${16 + round}T02:05:00.000Z`;
    const now = new Date(iso);
    const gate = new AgentGate({
      policies: [policy],
      audit,
      clock: { now: () => now },
      timezone: TZONE,
      signal_id_factory: () => `sig-${round}`,
    });
    const outcome = gate.evaluate(makeEvent({ type: 'focus_block_started', timestamp: iso }));
    if (outcome.signal !== null) {
      gate.respond({ signal_id: outcome.signal.id, action_id: 'dismiss', responded_at: iso });
    }
  }

  const report = buildReport([policy], audit.query(), { now: new Date(NOW), timezone: TZONE });
  assert.equal(report.suggestions.length, 1, 'the engine must have written what the suggester needs');
  assert.match(report.suggestions[0]?.proposed_change?.to ?? '', /^10:00-12:00$/);
});
