import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadSchema, schemaFiles } from '../src/schema/load.js';
import { validateSchema, type JsonSchema } from '../src/schema/validator.js';

/**
 * The validator is a hand-written subset, chosen for auditability. The
 * specific risk of that choice is a schema using a keyword nobody implemented:
 * the constraint then validates everything, no test fails, and the contract
 * quietly stops being enforced.
 *
 * scripts/audit-schemas.mjs reports that. These tests pin the behaviour of the
 * validator itself, so a keyword that *is* listed cannot silently regress.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_DIR = path.join(REPO, 'schemas');

const IMPLEMENTED = new Set([
  '$ref',
  'type',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'required',
  'properties',
  'patternProperties',
  'additionalProperties',
  'allOf',
  'anyOf',
  'oneOf',
]);

const ANNOTATION = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'default',
  'examples',
  '$comment',
  '$defs',
  'definitions',
]);

test('every schema file on disk is declared by schemaFiles, and vice versa', () => {
  const onDisk = readdirSync(SCHEMA_DIR)
    .filter((name) => name.endsWith('.schema.json'))
    .map((name) => name.replace(/\.schema\.json$/, ''))
    .sort();

  assert.deepEqual(onDisk, [...schemaFiles].sort());
});

test('no schema uses a keyword the validator does not implement', () => {
  const offenders: string[] = [];

  for (const name of schemaFiles) {
    const schema = loadSchema(name) as JsonSchema;
    walk(schema, name, '', schema, offenders);
  }

  assert.deepEqual(
    offenders,
    [],
    `these constraints validate nothing today; either implement them in src/schema/validator.ts or remove them:\n${offenders.join('\n')}`,
  );
});

function walk(node: unknown, schemaName: string, at: string, root: JsonSchema, offenders: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, schemaName, `${at}/${index}`, root, offenders));
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const isNameContainer = /\/(properties|\$defs|definitions)$/.test(at);
    if (!isNameContainer && !IMPLEMENTED.has(key) && !ANNOTATION.has(key)) {
      offenders.push(`${schemaName}${at}: ${key}`);
    }
    walk(value, schemaName, `${at}/${key}`, root, offenders);
  }
}

test('every $ref in every schema resolves', () => {
  for (const name of schemaFiles) {
    const schema = loadSchema(name) as JsonSchema;
    const unresolved = collectUnresolvedRefs(schema, schema, '');
    assert.deepEqual(unresolved, [], `${name} has unresolvable refs: ${unresolved.join(', ')}`);
  }
});

function collectUnresolvedRefs(node: unknown, root: JsonSchema, at: string, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => collectUnresolvedRefs(entry, root, `${at}/${index}`, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      if (!resolve(root, value)) out.push(`${at}: ${value}`);
      continue;
    }
    collectUnresolvedRefs(value, root, `${at}/${key}`, out);
  }
  return out;
}

function resolve(root: JsonSchema, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

console.log('\n== validator behaviour, keyword by keyword ==');

/**
 * A constraint the validator ignores is worse than one it rejects: rejection is
 * visible, silence is not. These assertions make "ignored" impossible for every
 * keyword the audit claims to support.
 */
const CASES: { keyword: string; schema: JsonSchema; accepts: unknown; rejects: unknown }[] = [
  { keyword: 'type', schema: { type: 'string' }, accepts: 'x', rejects: 1 },
  { keyword: 'enum', schema: { enum: ['a', 'b'] }, accepts: 'a', rejects: 'c' },
  { keyword: 'const', schema: { const: 7 }, accepts: 7, rejects: 8 },
  { keyword: 'minimum', schema: { type: 'number', minimum: 5 }, accepts: 5, rejects: 4 },
  { keyword: 'maximum', schema: { type: 'number', maximum: 5 }, accepts: 5, rejects: 6 },
  { keyword: 'exclusiveMinimum', schema: { type: 'number', exclusiveMinimum: 5 }, accepts: 6, rejects: 5 },
  { keyword: 'exclusiveMaximum', schema: { type: 'number', exclusiveMaximum: 5 }, accepts: 4, rejects: 5 },
  { keyword: 'minLength', schema: { type: 'string', minLength: 2 }, accepts: 'ab', rejects: 'a' },
  { keyword: 'maxLength', schema: { type: 'string', maxLength: 2 }, accepts: 'ab', rejects: 'abc' },
  { keyword: 'pattern', schema: { type: 'string', pattern: '^a+$' }, accepts: 'aa', rejects: 'ab' },
  {
    keyword: 'format (date-time)',
    schema: { type: 'string', format: 'date-time' },
    accepts: '2026-11-20T01:00:00.000Z',
    rejects: 'not-a-date',
  },
  { keyword: 'minItems', schema: { type: 'array', minItems: 2 }, accepts: [1, 2], rejects: [1] },
  { keyword: 'maxItems', schema: { type: 'array', maxItems: 1 }, accepts: [1], rejects: [1, 2] },
  {
    keyword: 'uniqueItems',
    schema: { type: 'array', uniqueItems: true },
    accepts: [1, 2],
    rejects: [1, 1],
  },
  {
    keyword: 'items',
    schema: { type: 'array', items: { type: 'number' } },
    accepts: [1, 2],
    rejects: [1, 'x'],
  },
  {
    keyword: 'required',
    schema: { type: 'object', required: ['a'] },
    accepts: { a: 1 },
    rejects: {},
  },
  {
    keyword: 'properties',
    schema: { type: 'object', properties: { a: { type: 'number' } } },
    accepts: { a: 1 },
    rejects: { a: 'x' },
  },
  {
    keyword: 'additionalProperties (false)',
    schema: { type: 'object', properties: { a: {} }, additionalProperties: false },
    accepts: { a: 1 },
    rejects: { a: 1, b: 2 },
  },
  {
    keyword: 'patternProperties',
    schema: { type: 'object', patternProperties: { '^x': { type: 'number' } }, additionalProperties: false },
    accepts: { x1: 1 },
    rejects: { x1: 'no' },
  },
  {
    keyword: 'allOf',
    schema: { allOf: [{ type: 'number' }, { minimum: 3 }] },
    accepts: 3,
    rejects: 2,
  },
  {
    keyword: 'anyOf',
    schema: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    accepts: 1,
    rejects: true,
  },
  {
    keyword: 'oneOf',
    schema: { oneOf: [{ type: 'string' }, { type: 'number', minimum: 10 }] },
    accepts: 11,
    rejects: 1,
  },
];

for (const testCase of CASES) {
  test(`the validator enforces ${testCase.keyword}`, () => {
    assert.equal(validateSchema(testCase.accepts, testCase.schema).valid, true, `${testCase.keyword} rejected a valid value`);
    assert.equal(validateSchema(testCase.rejects, testCase.schema).valid, false, `${testCase.keyword} accepted an invalid value`);
  });
}

test('an unresolvable $ref is an error, not a pass', () => {
  const result = validateSchema('anything', { $ref: '#/$defs/missing' });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.keyword, '$ref');
});

test('a $ref is followed to its target and enforced there', () => {
  const schema: JsonSchema = {
    $defs: { name: { type: 'string', minLength: 2 } },
    type: 'object',
    properties: { name: { $ref: '#/$defs/name' } },
  };
  assert.equal(validateSchema({ name: 'ok' }, schema).valid, true);
  assert.equal(validateSchema({ name: 'x' }, schema).valid, false);
});
