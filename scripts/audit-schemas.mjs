#!/usr/bin/env node
/**
 * Schema ↔ validator consistency audit.
 *
 * The runtime ships a hand-written validator (src/schema/validator.ts) for a
 * deliberate reason: no schema-library dependency, and rules a reviewer can
 * read. The risk of that choice is specific and quiet — a schema may use a
 * keyword the validator does not implement, and then that constraint validates
 * everything. No test fails; the contract simply stops being enforced.
 *
 * This script walks every schema and reports:
 *   1. keywords present in `schemas/*.schema.json` but unknown to the validator;
 *   2. keywords the validator implements but that no schema uses (harmless, but
 *      it says which code is untested);
 *   3. every `$ref` target that does not resolve;
 *   4. schema files on disk that `schemaFiles` does not list, and vice versa.
 *
 *   npm run audit-schemas
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCHEMA_DIR = path.join(ROOT, 'schemas')
const VALIDATOR = path.join(ROOT, 'src', 'schema', 'validator.ts')
const LOADER = path.join(ROOT, 'src', 'schema', 'load.ts')

/**
 * Keywords implemented by the validator's `check()`. Kept here by hand: the
 * point of the audit is to compare a written-down list against the schemas, so
 * deriving it from the source with a regex would make the list agree with
 * itself rather than with reality. The `implemented-keywords` cross-check below
 * mitigates that by verifying each one appears in validator.ts.
 */
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
])

/** Annotation keywords: present for humans and tooling, never validated. */
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
])

const problems = []
const notes = []

const validatorSource = readFileSync(VALIDATOR, 'utf8')

// 1. Every keyword we claim to implement must actually appear in the source.
for (const keyword of IMPLEMENTED) {
  if (!validatorSource.includes(`'${keyword}'`) && !validatorSource.includes(`.${keyword}`)) {
    problems.push(`validator.ts never mentions implemented keyword "${keyword}" — the audit list has drifted`)
  }
}

// 2. Discover the schema files and the loader's declared list.
const onDisk = readdirSync(SCHEMA_DIR)
  .filter((name) => name.endsWith('.schema.json'))
  .map((name) => name.replace(/\.schema\.json$/, ''))
  .sort()

const loaderSource = readFileSync(LOADER, 'utf8')
const declaredMatch = /export const schemaFiles = \[([^\]]+)\]/.exec(loaderSource)
if (declaredMatch === null) {
  problems.push('src/schema/load.ts does not declare `schemaFiles` in the expected form')
}
const declared = declaredMatch === null
  ? []
  : [...declaredMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()

for (const name of onDisk) {
  if (!declared.includes(name)) problems.push(`schemas/${name}.schema.json exists but schemaFiles does not list it`)
}
for (const name of declared) {
  if (!onDisk.includes(name)) problems.push(`schemaFiles lists "${name}" but schemas/${name}.schema.json is missing`)
}

// 3. Walk every schema for keywords and unresolvable refs.
const usedKeywords = new Set()

/** @param {unknown} node @param {string} schemaName @param {string} at @param {unknown} root */
function walk(node, schemaName, at, root) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, schemaName, `${at}/${index}`, root))
    return
  }
  if (typeof node !== 'object' || node === null) return

  for (const [key, value] of Object.entries(node)) {
    // Under `properties` and `$defs`, the keys are *names*, not keywords.
    const isNameContainer = /\/(properties|\$defs|definitions)$/.test(at)
    if (!isNameContainer) {
      usedKeywords.add(key)
      if (!IMPLEMENTED.has(key) && !ANNOTATION.has(key)) {
        problems.push(`${schemaName}${at}: keyword "${key}" is not implemented by src/schema/validator.ts`)
      }
    }

    if (key === '$ref' && typeof value === 'string') {
      if (!resolveRef(root, value)) {
        problems.push(`${schemaName}${at}: $ref "${value}" does not resolve inside this schema`)
      }
      continue
    }

    walk(value, schemaName, `${at}/${key}`, root)
  }
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) return undefined
  let current = root
  for (const raw of ref.slice(2).split('/')) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (typeof current !== 'object' || current === null) return undefined
    current = current[segment]
  }
  return current
}

for (const name of onDisk) {
  const schema = JSON.parse(readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'))
  walk(schema, name, '', schema)
}

// 4. Report implemented-but-unused keywords as notes, not failures.
const unused = [...IMPLEMENTED].filter((keyword) => !usedKeywords.has(keyword)).sort()
if (unused.length > 0) {
  notes.push(`validator implements keywords no schema exercises: ${unused.join(', ')}`)
}

if (process.argv.includes('--verbose')) {
  console.log(`schemas: ${onDisk.join(', ')}`)
  console.log(`implemented keywords: ${[...IMPLEMENTED].sort().join(', ')}`)
  console.log(`used keywords: ${[...usedKeywords].sort().join(', ')}`)
  for (const note of notes) console.log(`note: ${note}`)
}

if (problems.length > 0) {
  console.error(`schema audit failed (${problems.length} problem(s)):\n`)
  for (const problem of problems) console.error(`  ✖ ${problem}`)
  process.exitCode = 1
} else {
  console.log(
    `schema audit passed: ${onDisk.length} schemas, ${usedKeywords.size} keywords used, ` +
      `${IMPLEMENTED.size} implemented by the validator.`,
  )
  for (const note of notes) console.log(`  note: ${note}`)
}
