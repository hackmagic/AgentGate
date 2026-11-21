#!/usr/bin/env node
/**
 * Architecture guard for the three-layer contract:
 *
 *   events (adapters)  →  policy + signal + audit (engine core)  →  pet / mcp / compile (surfaces)
 *
 * Imports may only point "downwards". Adapters must not know about policies;
 * the core must not know about pets, MCP or compiled artifacts; and the
 * adapters must never reach around the engine into the audit store directly
 * unless that is their documented job.
 *
 * Run with `npm run lint`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

/** Layer → layers this layer is forbidden to import at runtime. */
const FORBIDDEN = {
  events: ['policy', 'signal', 'engine', 'pet', 'mcp', 'compile', 'audit'],
  audit: ['engine', 'pet', 'mcp', 'compile'],
  schema: ['engine', 'pet', 'mcp', 'compile', 'policy', 'signal', 'events', 'audit'],
  util: ['engine', 'pet', 'mcp', 'compile', 'policy', 'signal', 'events', 'audit'],
  policy: ['engine', 'pet', 'mcp', 'compile'],
  signal: ['engine', 'pet', 'mcp', 'compile'],
};

/** Files that must stay pure: value in → value out, no I/O, no clock access. */
const PURE = new Set([
  'policy/conditions.ts',
  'policy/evaluate.ts',
  'policy/mute.ts',
  'policy/validate.ts',
  'policy/summary.ts',
  'policy/types.ts',
  'signal/build.ts',
  'signal/validate.ts',
  'signal/types.ts',
  'events/normalize.ts',
]);

const IO_MODULES = new Set(['fs', 'fs/promises', 'http', 'https', 'net', 'readline', 'child_process', 'os']);

/** Only these may construct a GuidanceEngine. */
const ENGINE_IMPORTERS = new Set(['engine.ts', 'pet/bridge.ts', 'pet/http.ts', 'mcp/server.ts', 'cli.ts', 'index.ts']);

const problems = [];

function layerOf(relPath) {
  if (relPath === 'engine.ts') return 'engine';
  const [first, second] = relPath.split('/');
  if (second !== undefined) return first === 'util' || first === 'schema' ? first : first;
  return 'misc';
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

    if (target === 'engine.ts' && !ENGINE_IMPORTERS.has(rel)) {
      problems.push(`${where} constructs/consumes GuidanceEngine directly; go through an adapter (src/pet, src/mcp, src/cli)`);
    }
  });
}

/** Every public module must be reachable from src/index.ts. */
const indexText = readFileSync(path.join(SRC, 'index.ts'), 'utf8');
for (const required of ['engine', 'policy', 'signal', 'audit', 'events', 'pet', 'mcp', 'compile']) {
  if (!indexText.includes(`'./${required}`) && !indexText.includes(`"./${required}`)) {
    problems.push(`src/index.ts does not re-export "./${required}"`);
  }
}

if (problems.length > 0) {
  console.error('architecture check failed:\n');
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log('architecture check passed: adapters → engine → surfaces stays one-directional.');
