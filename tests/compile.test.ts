import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileAllTargets, compilePolicies, COMPILE_TARGETS, writeBundle } from '../src/compile/index.js';
import { loadPolicyDirectory } from '../src/policy/load.js';
import { validatePolicyDocument } from '../src/policy/validate.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PACK = path.join(REPO, 'packs', 'deep-work');

const loaded = loadPolicyDirectory(PACK);
const policies = loaded.map((entry) => entry.policy);

test('one policy set compiles to all three agent surfaces', () => {
  const bundles = compileAllTargets(policies);
  assert.deepEqual(
    bundles.map((bundle) => bundle.target),
    [...COMPILE_TARGETS],
  );

  for (const bundle of bundles) {
    assert.ok(bundle.files.length > 0, `${bundle.target} produced no files`);
    assert.equal(bundle.engine_version, '0.1.0');
  }
});

test('the source hash is identical across targets and stable across runs', () => {
  const hashes = COMPILE_TARGETS.map((target) => compilePolicies(policies, target).source_hash);
  assert.equal(new Set(hashes).size, 1, 'all targets must describe the same compiled policy set');

  const again = compilePolicies(policies, 'agents');
  assert.equal(again.source_hash, hashes[0]);

  const changed = policies.map((policy, index) =>
    index === 0 ? { ...policy, priority: policy.priority + 1 } : policy,
  );
  assert.notEqual(compilePolicies(changed, 'agents').source_hash, hashes[0]);
});

test('AGENTS.md contains one chapter per policy with its boundary rules', () => {
  const bundle = compilePolicies(policies, 'agents');
  const file = bundle.files.find((entry) => entry.path === 'AGENTS.md');
  assert.ok(file !== undefined);

  assert.match(file.content, /## 通用求值规则/);
  for (const policy of policies) {
    assert.ok(file.content.includes(`## ${policy.description}`), `missing chapter for ${policy.id}`);
    assert.ok(file.content.includes(`\`${policy.id}\``));
  }
  assert.match(file.content, /### 禁止事项/);
  assert.match(file.content, /不得截屏/);
  assert.ok(file.content.includes(bundle.source_hash.slice(0, 12)) === false, 'per-policy hash is used, not the set hash');
});

test('SKILL.md frontmatter and instructions mirror the policy decision', () => {
  const bundle = compilePolicies(policies, 'skill');
  const morning = policies.find((policy) => policy.id === 'morning-focus-protection');
  assert.ok(morning !== undefined);

  const file = bundle.files.find((entry) => entry.path === 'skills/guidance-morning-focus-protection/SKILL.md');
  assert.ok(file !== undefined);
  assert.match(file.content, /^---\nname: guidance-morning-focus-protection\n/);
  assert.match(file.content, /description: /);
  assert.match(file.content, /require_approval/);
  assert.match(file.content, /guidance\/evaluate/);
  assert.match(file.content, /不得改写文案|原样交给呈现层/);

  const skillFiles = bundle.files.filter((entry) => entry.path.endsWith('SKILL.md'));
  assert.equal(skillFiles.length, policies.length);
});

test('the MCP bundle ships an installable config plus reloadable policies', () => {
  const bundle = compilePolicies(policies, 'mcp');
  const config = bundle.files.find((entry) => entry.path === 'mcp.json');
  assert.ok(config !== undefined);

  const parsed = JSON.parse(config.content) as {
    mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  };
  const server = parsed.mcpServers['guidance'];
  assert.ok(server !== undefined);
  assert.equal(server.command, 'npx');
  assert.ok(server.args.join(' ').includes('guidance-runtime'));
  assert.ok(server.args.join(' ').includes('mcp'));

  const policyFiles = bundle.files.filter((entry) => entry.path.startsWith('guidance-policies/'));
  assert.equal(policyFiles.length, policies.length);

  // The emitted YAML documents must round-trip through the validator.
  for (const entry of policyFiles) {
    const document: unknown = JSON.parse(entry.content);
    const result = validatePolicyDocument(document);
    assert.equal(result.valid, true, `${entry.path}: ${result.issues.map((issue) => issue.code).join(',')}`);
  }

  assert.ok(bundle.files.some((entry) => entry.path === 'README.md'));
});

test('writeBundle materializes a bundle without escaping its directory', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'guidance-compile-'));
  try {
    const bundle = compilePolicies(policies, 'mcp');
    const written = writeBundle(bundle, directory);

    assert.equal(written.length, bundle.files.length);
    assert.ok(readFileSync(path.join(directory, 'mcp.json'), 'utf8').includes('mcpServers'));
    const names = readdirSync(path.join(directory, 'guidance-policies'));
    assert.equal(names.length, policies.length);

    const evil = { ...bundle, files: [{ path: '../escape.md', content: 'x', sha256: 'x' }] };
    assert.throws(() => writeBundle(evil, directory), /escape|outside|absolute|relative/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('file hashes describe the emitted bytes', () => {
  const bundle = compilePolicies(policies, 'agents');
  for (const file of bundle.files) {
    assert.equal(file.sha256.length, 64);
  }
});
