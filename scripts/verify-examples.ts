import { readFileSync } from 'node:fs';

import { AgentGate } from '../src/gate/index.js';
import { MemoryAuditStore } from '../src/audit/store.js';
import { loadPolicyDirectory } from '../src/policy/load.js';
import { normalizeEvent } from '../src/events/normalize.js';

/**
 * Replay the example sequences against their pack and compare with the
 * documented expectation.
 *
 * The fixtures record what each case is *supposed* to do. Without this, a YAML
 * edit could quietly change an outcome and the fixture would keep claiming the
 * old one — a stale expectation is worse than no expectation.
 */

const FILES = ['examples/health-break-sequences.json', 'examples/context-switch-guard-sequences.json'];

let failures = 0;
let checked = 0;

for (const file of FILES) {
  const spec = JSON.parse(readFileSync(file, 'utf8')) as {
    pack: string;
    timezone: string;
    sequences: Array<{
      id: string;
      expect: { decision: string; policy_id: string | null };
      why: string;
      event: unknown;
    }>;
  };

  const policies = loadPolicyDirectory(`packs/${spec.pack}`).map((entry) => entry.policy);

  console.log(`\n=== ${spec.pack} ===`);

  for (const sequence of spec.sequences) {
    const event = normalizeEvent(sequence.event);

    const gate = new AgentGate({
      policies,
      audit: new MemoryAuditStore(),
      clock: { now: () => new Date(event.timestamp) },
      timezone: spec.timezone,
      signal_id_factory: () => `sig-${sequence.id}`,
    });

    const outcome = gate.evaluate(event);
    checked += 1;

    const decisionOk = outcome.decision === sequence.expect.decision;
    const policyOk = (outcome.matched_policy_id ?? null) === sequence.expect.policy_id;

    if (decisionOk && policyOk) {
      console.log(`  ok    ${sequence.id} -> ${outcome.decision} / ${outcome.matched_policy_id ?? '(none)'}`);
    } else {
      failures += 1;
      console.log(
        `  FAIL  ${sequence.id}: expected ${sequence.expect.decision} / ${sequence.expect.policy_id ?? '(none)'}, ` +
          `got ${outcome.decision} / ${outcome.matched_policy_id ?? '(none)'}`,
      );
      console.log(`        ${sequence.why}`);
    }
  }
}

console.log(`\n${checked} sequence(s) checked, ${failures} failure(s)`);
if (failures > 0) process.exitCode = 1;
