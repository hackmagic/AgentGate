import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadPolicyDirectory } from '../src/policy/load.js';
import { compilePolicies } from '../src/compile/index.js';

/**
 * Verify the "no field may be dropped" table in docs/06 §6.3 against real
 * generated artifacts.
 *
 * Running this as a check rather than trusting the prose is the point: a table
 * claiming "✅ pass" is worth exactly as much as the run behind it.
 */

const PACK = 'packs/deep-work';
const policies = loadPolicyDirectory(PACK).map((entry) => entry.policy);
const bundle = compilePolicies(policies, 'skill');

/** Flatten `time_window` and `day_of_week` values out of a condition tree. */
function conditionFacts(condition: unknown, out: { windows: string[]; weekdays: string[] } = { windows: [], weekdays: [] }) {
  if (Array.isArray(condition)) {
    for (const entry of condition) conditionFacts(entry, out);
    return out;
  }
  if (typeof condition !== 'object' || condition === null) return out;

  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (key === 'time_window' && typeof value === 'string') out.windows.push(value);
    else if (key === 'day_of_week' && Array.isArray(value)) {
      for (const day of value) out.weekdays.push(String(day));
    } else {
      conditionFacts(value, out);
    }
  }
  return out;
}

const failures: string[] = [];

console.log('=== deep-work SKILL.md field check ===');

for (const policy of policies) {
  const file = bundle.files.find((entry) => entry.path.includes(`agent-gate-${policy.id}/`));
  if (file === undefined) {
    failures.push(`${policy.id}: no artifact generated`);
    console.log(`  ${policy.id.padEnd(32)} FAIL (no artifact)`);
    continue;
  }

  const body = file.content;
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(body)?.[1] ?? '';
  const facts = conditionFacts(policy.conditions);

  const checks: Record<string, boolean> = {
    'trigger.event': body.includes(`\`${policy.trigger.event}\``),
    'trigger.context': (policy.trigger.context?.app ?? []).every((app) => body.includes(app)),
    'conditions.time_window': facts.windows.every((window) => body.includes(window)),
    'conditions.day_of_week': facts.weekdays.every((day) => body.includes(day)),
    decision: body.includes(`\`${policy.decision}\``),
    'requires_approval': body.includes(
      policy.safety.requires_approval ? '需要用户明确批准' : '不需要逐次批准',
    ),
    'audit_level': body.includes(`审计级别：${policy.safety.audit_level}`),
    'bubble_text': policy.presentation?.bubble_text === undefined
      ? true
      : body.includes(policy.presentation.bubble_text),
    'action_ids': (policy.presentation?.actions ?? []).every((action) => body.includes(`\`${action.action_id}\``)),
    'action.type': policy.action === undefined ? true : body.includes(`\`${policy.action.type}\``),
    'escalation': policy.escalation === undefined
      ? true
      : body.includes(`${policy.escalation.after_minutes} 分钟`) && body.includes(policy.escalation.action),
    'name equals dir': new RegExp(`name: agent-gate-${policy.id.replace(/[^a-z0-9-]+/g, '-')}\n`).test(frontmatter),
    'description within 1024': ((frontmatter.match(/description: (.+)/)?.[1] ?? '').length) <= 1024,
    'priority absent': !/优先级/.test(body),
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    failures.push(`${policy.id}: ${failed.join(', ')}`);
    console.log(`  ${policy.id.padEnd(32)} FAIL: ${failed.join(', ')}`);
  } else {
    console.log(`  ${policy.id.padEnd(32)} ${Object.keys(checks).length} checks ok`);
  }
}

// Longest name across the whole pack, against the host limit.
let longestName = '';
for (const file of bundle.files) {
  const name = /^name: (.+)$/m.exec(file.content)?.[1] ?? '';
  if (name.length > longestName.length) longestName = name;
}

console.log(`\nlongest name: ${longestName} (${longestName.length} chars, limit 64)`);
console.log(`policies: ${policies.length}, failures: ${failures.length}`);

if (longestName.length > 64) failures.push(`name exceeds 64 chars: ${longestName}`);
if (policies.length === 0) failures.push('no policies loaded from the pack');

if (failures.length > 0) {
  console.error('\nfailures:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
}
