import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compilePolicies } from '../src/compile/index.js';
import { loadPolicyDirectory } from '../src/policy/load.js';
import { TOOL_NAMES } from '../src/mcp/server.js';
import { validatePolicyDocument } from '../src/policy/validate.js';
import type { Policy } from '../src/policy/types.js';

/**
 * Minimum usability of the `skill` target.
 *
 * "It has frontmatter and some prose" is not the bar. A SKILL.md that a host
 * can load but a model cannot *act on* is worse than no skill: the model will
 * invent the missing step. Each test below corresponds to one clause of
 * docs/06-compiler-spec.md §7.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ALL_PACKS = ['deep-work', 'health-break', 'context-switch-guard'];

function policiesOf(pack: string): Policy[] {
  return loadPolicyDirectory(path.join(REPO, 'packs', pack)).map((entry) => entry.policy);
}

const everyPolicy = ALL_PACKS.flatMap((pack) => policiesOf(pack).map((policy) => ({ pack, policy })));

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  assert.ok(match !== null, 'SKILL.md must start with a YAML frontmatter block');
  return { frontmatter: match[1] as string, body: match[2] as string };
}

console.log('\n== clause 1: discoverable frontmatter ==');

test('every skill has frontmatter whose name matches its directory, and a non-empty description', () => {
  for (const pack of ALL_PACKS) {
    const bundle = compilePolicies(policiesOf(pack), 'skill');
    for (const file of bundle.files) {
      const { frontmatter } = splitFrontmatter(file.content);
      const name = /^name: (.+)$/m.exec(frontmatter)?.[1]?.trim();
      const description = /^description: (.+)$/m.exec(frontmatter)?.[1]?.trim();

      assert.ok(name !== undefined && name.length > 0, `${file.path}: missing frontmatter name`);
      assert.ok(description !== undefined && description.length > 0, `${file.path}: missing description`);

      // The host indexes by directory, so a mismatch orphans the skill.
      const directory = path.basename(path.dirname(file.path));
      assert.equal(name, directory, `${file.path}: frontmatter name must equal its directory name`);

      // Hosts truncate in list views; the id must survive near the front.
      assert.ok(description.length <= 1000, `${file.path}: description exceeds 1000 characters`);
    }
  }
});

test('the description states the approval stance, so a list view is enough to triage', () => {
  for (const { policy } of everyPolicy) {
    const bundle = compilePolicies([policy], 'skill');
    const { frontmatter } = splitFrontmatter(bundle.files[0]!.content);
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? '';

    assert.ok(
      description.includes('批准'),
      `${policy.id}: the description must say whether approval is required before acting`,
    );
    if (policy.safety.requires_approval) {
      assert.ok(
        description.includes('必须先取得用户批准'),
        `${policy.id}: an approval-gated policy must say so in the description`,
      );
    }
  }
});

console.log('\n== clause 2: the decision is stated, not implied ==');

test('every skill names its own decision and tells the model what allow means', () => {
  for (const { policy } of everyPolicy) {
    const content = compilePolicies([policy], 'skill').files[0]!.content;
    assert.ok(content.includes(`\`${policy.decision}\``), `${policy.id}: its decision is never stated`);
    assert.ok(content.includes('`allow`'), `${policy.id}: no instruction for the allow case`);
  }
});

console.log('\n== clause 3: every offered action is parseable ==');

test('each action offered by a policy appears verbatim in its skill', () => {
  for (const { policy } of everyPolicy) {
    const content = compilePolicies([policy], 'skill').files[0]!.content;
    for (const action of policy.presentation?.actions ?? []) {
      assert.ok(
        content.includes(`\`${action.action_id}\``),
        `${policy.id}: action "${action.action_id}" is offered to the user but missing from the skill`,
      );
    }
  }
});

test('a skill never invents an action id the engine would reject', () => {
  const legal = new Set(['approve', 'dismiss', 'mute_1h']);
  for (const { policy } of everyPolicy) {
    const content = compilePolicies([policy], 'skill').files[0]!.content;
    // Action ids appear as backticked snake tokens in the回执 list.
    const listed = [...content.matchAll(/^- `([a-z0-9_]+)`$/gm)].map((match) => match[1] as string);
    for (const actionId of listed) {
      assert.ok(legal.has(actionId), `${policy.id}: skill lists "${actionId}", which the engine does not accept`);
    }
  }
});

console.log('\n== clause 4: the receipt path is real ==');

test('a skill does not instruct the model to call an MCP tool for responses', () => {
  // The MCP surface has no respond tool. If a skill told a model otherwise, the
  // model would either fail or, worse, claim the user approved something.
  const respondTool = TOOL_NAMES.find((name) => name.includes('respond'));
  assert.equal(respondTool, undefined, 'this test assumes MCP has no respond tool; update it if one is added');

  for (const { policy } of everyPolicy) {
    const content = compilePolicies([policy], 'skill').files[0]!.content;
    assert.equal(
      /`gate\/respond`/.test(content),
      false,
      `${policy.id}: refers to a gate/respond tool that does not exist`,
    );
    assert.ok(
      content.includes('/v1/signals/'),
      `${policy.id}: must name the real receipt route`,
    );
  }
});

test('a skill says what to do when the embodiment bridge is absent', () => {
  for (const { policy } of everyPolicy) {
    const content = compilePolicies([policy], 'skill').files[0]!.content;
    assert.ok(
      content.includes('没有宠物桥') || content.includes('不得假装'),
      `${policy.id}: no instruction for the missing-bridge case, so a model will improvise a fake approval`,
    );
  }
});

console.log('\n== clause 5: it stays in sync with the engine ==');

test('every skill states the format version and a source hash', () => {
  for (const { policy } of everyPolicy) {
    const content = compilePolicies([policy], 'skill').files[0]!.content;
    assert.match(content, /编译格式 v\d+/, `${policy.id}: no format version, so a stale skill is undetectable`);
    assert.ok(content.includes(policy.id), `${policy.id}: does not identify itself`);
  }
});

test('a skill carries the five semantic rules that constrain execution', () => {
  for (const { policy } of everyPolicy) {
    const content = compilePolicies([policy], 'skill').files[0]!.content;
    assert.ok(content.includes('不得改写文案'), `${policy.id}: does not forbid rewriting policy copy`);
    assert.ok(content.includes('不会自动重试') || content.includes('不要换个说法重试'), `${policy.id}: does not forbid retry after refusal`);
  }
});

test('the skill output is deterministic for one policy', () => {
  const policy = everyPolicy[0]!.policy;
  const first = compilePolicies([policy], 'skill').files[0]!.content;
  const second = compilePolicies([policy], 'skill').files[0]!.content;
  assert.equal(first, second, 'two compilations of the same policy must be byte-identical');
});

console.log('\n== clause 6: rendered skill still passes the policy validator ==');

test('a policy recovered from a skill bundle is still a valid policy', () => {
  // The MCP target ships policy copies; the skill target ships §-sections.
  // This asserts the underlying object survives the compiler untouched, which
  // is what `gate verify` relies on.
  for (const { policy } of everyPolicy) {
    const result = validatePolicyDocument({ policy });
    assert.equal(result.valid, true, `${policy.id}: ${result.issues.map((issue) => issue.code).join(',')}`);
  }
});
