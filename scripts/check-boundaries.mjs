#!/usr/bin/env node
/**
 * Architecture guard for the layered contract (docs/zh-cn/02-architecture.md):
 *
 *   events (adapters) → policy + signal + audit (pure core) → gate (composition)
 *                                                          → pet / mcp / compile (surfaces)
 *
 * Imports may only point "downwards". Adapters must not know about policies;
 * the pure core must not know about the gate, pets, MCP or compiled artifacts;
 * and only the composition layer may construct an AgentGate.
 *
 * Run with `npm run lint`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

/** Layer → layers this layer is forbidden to import at runtime. */
const FORBIDDEN = {
  events: ['policy', 'signal', 'gate', 'pet', 'mcp', 'compile', 'audit'],
  audit: ['gate', 'pet', 'mcp', 'compile'],
  schema: ['gate', 'pet', 'mcp', 'compile', 'policy', 'signal', 'events', 'audit'],
  util: ['gate', 'pet', 'mcp', 'compile', 'policy', 'signal', 'events', 'audit'],
  policy: ['gate', 'pet', 'mcp', 'compile'],
  signal: ['gate', 'pet', 'mcp', 'compile'],
  gate: ['pet', 'mcp', 'compile'],
  compile: ['gate', 'pet', 'mcp'],
};

/**
 * Files that must stay pure: value in → value out, no I/O, no clock access.
 *
 * `gate/` is deliberately absent: the gate is where composition and side
 * effects are allowed to live. Everything a decision is made of stays here.
 */
const PURE = new Set([
  'policy/conditions.ts',
  'policy/evaluate.ts',
  'policy/mute.ts',
  'policy/validate.ts',
  'policy/summary.ts',
  'policy/types.ts',
  'policy/lifecycle.ts',
  'signal/build.ts',
  'signal/validate.ts',
  'signal/types.ts',
  'events/normalize.ts',
  'compile/support.ts',
  'compile/verify.ts',
  'compile/agents-md.ts',
  'compile/skill-md.ts',
  'compile/mcp-bundle.ts',
]);

const IO_MODULES = new Set(['fs', 'fs/promises', 'http', 'https', 'net', 'readline', 'child_process', 'os']);

/** Only these may construct an AgentGate. */
const GATE_CONSTRUCTORS = new Set([
  'gate/gate.ts',
  'gate/index.ts',
  'pet/bridge.ts',
  'pet/http.ts',
  'mcp/server.ts',
  'cli.ts',
  'index.ts',
]);

const problems = [];

function layerOf(relPath) {
  const [first] = relPath.split('/');
  return first ?? 'misc';
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
  }
  return files.sort();
}

const IMPORT_RE = /^\s*import\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/;

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const layer = layerOf(rel);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    const match = IMPORT_RE.exec(line);
    if (match === null) return;
    const typeOnly = match[1] !== undefined;
    const specifier = match[2];
    const where = `${rel}:${index + 1}`;

    if (IO_MODULES.has(specifier.replace(/^node:/, '')) && PURE.has(rel)) {
      problems.push(`${where} pure module "${rel}" must not perform I/O (imports "${specifier}")`);
    }

    if (!specifier.startsWith('.')) return;

    const target = path.relative(SRC, path.resolve(path.dirname(file), specifier)).split(path.sep).join('/');
    const targetLayer = layerOf(target);

    const forbidden = FORBIDDEN[layer];
    if (forbidden !== undefined && !typeOnly && forbidden.includes(targetLayer)) {
      problems.push(`${where} layer "${layer}" must not import "${targetLayer}" (${target})`);
    }

    if (targetLayer === 'gate' && !GATE_CONSTRUCTORS.has(rel) && !rel.startsWith('gate/')) {
      problems.push(
        `${where} layer "${layer}" must not consume the gate directly; go through an adapter (src/pet, src/mcp, src/cli)`,
      );
    }
  });
}

/** Every public module must be reachable from src/index.ts. */
const indexText = readFileSync(path.join(SRC, 'index.ts'), 'utf8');
for (const required of ['gate', 'policy', 'signal', 'audit', 'events', 'pet', 'mcp', 'compile']) {
  if (!indexText.includes(`'./${required}`) && !indexText.includes(`"./${required}`)) {
    problems.push(`src/index.ts does not re-export "./${required}"`);
  }
}

/**
 * Pure core must not read the clock or perform I/O. Nondeterministic ids are
 * allowed, but only as an *injectable default*: a module that calls
 * `randomUUID()` must also expose a factory option callers can override, so
 * every decision stays reproducible in tests.
 */
for (const rel of PURE) {
  const text = readFileSync(path.join(SRC, rel), 'utf8');
  if (/\b(Date\.now|new Date\(\)|performance\.now)\b/.test(text)) {
    problems.push(`${rel} is a pure module and must not read the system clock; take \`now\` as an argument`);
  }
  if (/from ['"]node:crypto['"]/.test(text) && !/(idFactory|id_factory|signal_id_factory)/.test(text)) {
    problems.push(`${rel} generates ids without offering an injectable factory; tests cannot make it deterministic`);
  }
}

if (problems.length > 0) {
  console.error('architecture check failed:\n');
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log('architecture check passed: adapters → pure core → gate → surfaces stays one-directional.');
