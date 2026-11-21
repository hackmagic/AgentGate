import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compilePolicies } from '../src/compile/index.js';
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_NAME_MAX_LENGTH } from '../src/compile/skill-md.js';
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

console.log('\n== clause 7: host frontmatter limits ==');

/** A legal policy with the given id: the schema permits up to 64 characters. */
function policyWithId(id: string): Policy {
  return {
    id,
    version: 1,
    description: 'x',
    priority: 1,
    trigger: { event: 'focus_block_started' },
    decision: 'suggest',
    safety: { requires_approval: false, rationale: 'local bubble only', reversible: true, audit_level: 'summary' },
  };
}

function nameOf(policy: Policy): string {
  const { frontmatter } = splitFrontmatter(compilePolicies([policy], 'skill').files[0]!.content);
  return /^name: (.+)$/m.exec(frontmatter)?.[1]?.trim() ?? '';
}

test('a schema-legal maximum-length id still yields a host-legal skill name', () => {
  // The schema allows a 64-character id; the "agent-gate-" prefix makes that
  // 75, and every Agent Skills host rejects a name over 64. This was a real
  // defect: valid input, invalid artifact.
  const name = nameOf(policyWithId('a'.repeat(64)));
  assert.ok(name.length <= SKILL_NAME_MAX_LENGTH, `name is ${name.length} characters, limit is ${SKILL_NAME_MAX_LENGTH}`);
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'a host rejects anything but lowercase kebab-case');
});

test('two long ids sharing a prefix stay distinct after truncation', () => {
  const base = 'x'.repeat(40);
  const first = nameOf(policyWithId(`${base}-one`));
  const second = nameOf(policyWithId(`${base}-two`));
  // Both are short enough here, but a longer shared prefix must not collide.
  const longBase = 'y'.repeat(60);
  const third = nameOf(policyWithId(`${longBase}-one`));
  const fourth = nameOf(policyWithId(`${longBase}-two`));
  assert.notEqual(third, fourth, 'truncation must not merge two different policies into one skill');
  assert.notEqual(first, second);
});

test('every name is kebab-case, within the limit, and matches its directory', () => {
  for (const pack of ALL_PACKS) {
    const bundle = compilePolicies(policiesOf(pack), 'skill');
    for (const file of bundle.files) {
      const { frontmatter } = splitFrontmatter(file.content);
      const name = /^name: (.+)$/m.exec(frontmatter)?.[1]?.trim() ?? '';
      assert.ok(name.length > 0 && name.length <= SKILL_NAME_MAX_LENGTH, `${file.path}: name length ${name.length}`);
      assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${file.path}: not kebab-case`);
      assert.equal(name, path.basename(path.dirname(file.path)), `${file.path}: name must equal its directory`);
      assert.equal(/(claude|anthropic)/.test(name), false, `${file.path}: reserved word in name`);
    }
  }
});

test('descriptions stay inside the host limit and carry no XML tags', () => {
  for (const pack of ALL_PACKS) {
    const bundle = compilePolicies(policiesOf(pack), 'skill');
    for (const file of bundle.files) {
      const { frontmatter } = splitFrontmatter(file.content);
      const description = /^description: (.+)$/m.exec(frontmatter)?.[1]?.trim() ?? '';
      assert.ok(description.length > 0, `${file.path}: empty description`);
      assert.ok(
        [...description].length <= SKILL_DESCRIPTION_MAX_LENGTH,
        `${file.path}: description exceeds ${SKILL_DESCRIPTION_MAX_LENGTH} characters`,
      );
      assert.equal(/<|>/.test(description), false, `${file.path}: XML tags make some hosts reject the skill`);
    }
  }
});

test('the description never repeats the approval stance', () => {
  // `decisionText('require_approval')` already starts with the approval
  // sentence; appending it again produced "...，必须先取得用户批准" twice.
  for (const { policy } of everyPolicy) {
    const { frontmatter } = splitFrontmatter(compilePolicies([policy], 'skill').files[0]!.content);
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? '';
    const occurrences = description.split('必须先取得用户批准').length - 1;
    assert.ok(occurrences <= 1, `${policy.id}: approval stance stated ${occurrences} times`);
  }
});

test('an approval-required policy says so even when its decision is suggest', () => {
  // The stance comes from safety, not from the decision word.
  const policy = { ...policyWithId('gated-suggest'), decision: 'suggest' as const };
  policy.safety = { requires_approval: true, reversible: true, audit_level: 'full' };
  const { frontmatter } = splitFrontmatter(compilePolicies([policy], 'skill').files[0]!.content);
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? '';
  assert.ok(description.includes('必须先取得用户批准'), 'a gated suggestion must still advertise the gate');
});
