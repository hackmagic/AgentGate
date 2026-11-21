import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileAllTargets, compilePolicies, COMPILE_FORMAT_VERSION } from '../src/compile/index.js';
import { readAgentsMd, readSkillMd, verifyCompilation } from '../src/compile/verify.js';
import { loadPolicyDirectory } from '../src/policy/load.js';
import type { CompilationBundle } from '../src/compile/index.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PACK = path.join(REPO, 'packs', 'deep-work');
const policies = loadPolicyDirectory(PACK).map((entry) => entry.policy);

test('every target reports the same source hash and format version', () => {
  const bundles = compileAllTargets(policies);
  assert.equal(new Set(bundles.map((bundle) => bundle.source_hash)).size, 1);
  assert.equal(new Set(bundles.map((bundle) => bundle.format_version)).size, 1);
  assert.equal(bundles[0]?.format_version, COMPILE_FORMAT_VERSION);
});

test('the bundled pack compiles to a parity-clean set', () => {
  const report = verifyCompilation(policies, compileAllTargets(policies));
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
  assert.ok(report.source_hash !== null);

  // Every policy must be recoverable from every target.
  for (const target of ['agents', 'skill', 'mcp']) {
    const ids = (report.facts[target] ?? []).map((fact) => fact.policy_id).sort();
    assert.deepEqual(ids, policies.map((policy) => policy.id).sort(), `${target} lost a policy`);
  }
});

test('parity catches a target rendered from a different policy set', () => {
  const bundles = compileAllTargets(policies);
  const drifted: CompilationBundle = {
    ...bundles[0]!,
    source_hash: 'f'.repeat(64),
  };

  const report = verifyCompilation(policies, [drifted, bundles[1]!, bundles[2]!]);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === 'source_hash_mismatch'));
});

test('parity catches a lossy renderer that keeps the hash', () => {
  // Simulate a renderer that drops the approval flag: the hash still matches,
  // so only the fidelity half of the check can catch it.
  const bundles = compileAllTargets(policies);
  const agents = bundles.find((bundle) => bundle.target === 'agents');
  assert.ok(agents !== undefined);

  const file = agents.files[0]!;
  const tampered: CompilationBundle = {
    ...agents,
    files: [
      {
        ...file,
        content: file.content.replace(
          '- 需要用户明确批准后才能影响系统状态。',
          '- 不需要逐次批准，理由：rendered wrong',
        ),
      },
    ],
  };

  const report = verifyCompilation(policies, [tampered, ...bundles.filter((bundle) => bundle.target !== 'agents')]);
  assert.equal(report.ok, false);
  assert.ok(
    report.issues.some((issue) => issue.code === 'approval_drift'),
    `expected approval_drift, got ${report.issues.map((issue) => issue.code).join(',')}`,
  );
});

test('parity catches an artifact that drops a policy entirely', () => {
  const bundles = compileAllTargets(policies);
  const mcp = bundles.find((bundle) => bundle.target === 'mcp');
  assert.ok(mcp !== undefined);

  const surviving = mcp.files.filter((file) => !file.path.startsWith('agent-gate-policies/evening-quiet-hours'));
  const lossy: CompilationBundle = { ...mcp, files: surviving };

  const report = verifyCompilation(policies, [bundles[0]!, bundles[1]!, lossy]);
  assert.ok(report.issues.some((issue) => issue.code === 'missing_policy'));
});

test('an emitted policy copy must still validate, or parity fails', () => {
  const bundles = compileAllTargets(policies);
  const mcp = bundles.find((bundle) => bundle.target === 'mcp');
  assert.ok(mcp !== undefined);

  const corrupted: CompilationBundle = {
    ...mcp,
    files: mcp.files.map((file) =>
      file.path.startsWith('agent-gate-policies/')
        ? { ...file, content: '{"policy":{"id":"broken"}}\n' }
        : file,
    ),
  };

  const report = verifyCompilation(policies, [bundles[0]!, bundles[1]!, corrupted]);
  assert.ok(
    report.issues.some((issue) => issue.code === 'invalid_policy_copy'),
    `expected invalid_policy_copy, got ${report.issues.map((issue) => issue.code).join(',')}`,
  );
});

test('the AGENTS.md reader recovers exactly the facts it should', () => {
  const content = compilePolicies(policies, 'agents').files[0]!.content;
  const facts = readAgentsMd(content);

  assert.equal(facts.length, policies.length);
  const morning = facts.find((fact) => fact.policy_id === 'morning-focus-protection');
  assert.ok(morning !== undefined);
  assert.equal(morning.decision, 'require_approval');
  assert.equal(morning.requires_approval, true);
  assert.equal(morning.bubble_text, '进入 50 分钟专注？');
});

test('the SKILL.md reader recovers the same facts as the AGENTS.md reader', () => {
  const agentsFacts = readAgentsMd(compilePolicies(policies, 'agents').files[0]!.content);
  const skillBundle = compilePolicies(policies, 'skill');
  const skillFacts = skillBundle.files
    .filter((file) => file.path.endsWith('SKILL.md'))
    .map((file) => readSkillMd(file.content))
    .filter((fact) => fact !== null);

  assert.equal(skillFacts.length, policies.length);
  for (const fact of skillFacts) {
    const counterpart = agentsFacts.find((entry) => entry.policy_id === fact.policy_id);
    assert.ok(counterpart !== undefined, `skill ${fact.policy_id} has no AGENTS.md chapter`);
    assert.equal(fact.decision, counterpart.decision, `${fact.policy_id}: decision differs between targets`);
    assert.equal(
      fact.requires_approval,
      counterpart.requires_approval,
      `${fact.policy_id}: approval stance differs between targets`,
    );
  }
});

test('a policy copy that fails validation is reported, not silently accepted', () => {
  const facts = readSkillMd('---\nname: x\n---\n\nno policy id here\n');
  assert.equal(facts, null);
});
