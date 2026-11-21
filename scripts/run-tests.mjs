#!/usr/bin/env node
/**
 * Test entry point that works on every OS and every Node version we support.
 *
 * `node --test "tests/**\/*.test.ts"` is not portable: bash does not expand
 * quoted globs and Node 20 does not expand them itself. So we enumerate the
 * files here and hand Node explicit paths.
 *
 * Extra arguments are forwarded, e.g. `npm test -- --test-name-pattern rule`.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TESTS = path.join(ROOT, 'tests');

const files = readdirSync(TESTS)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => path.join('tests', name));

if (files.length === 0) {
  console.error('no test files found under tests/');
  process.exit(1);
}

const forwarded = process.argv.slice(2).filter((argument) => argument !== '--');
const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--test', ...forwarded, ...files],
  { cwd: ROOT, stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`test runner terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
