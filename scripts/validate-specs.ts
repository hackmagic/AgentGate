#!/usr/bin/env node
/**
 * Spec gate for CI: makes sure the *contracts* are internally consistent and
 * that the code constants still match the JSON Schemas shipped in `schemas/`.
 *
 *   npm run validate-specs
 *
 * Failing here means a spec drifted, not that an implementation detail broke.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { AUDIT_FIELD_WHITELIST } from '../src/audit/store.js';
import { COMPILE_FORMAT_VERSION, ENGINE_VERSION } from '../src/version.js';
import { EVENT_SOURCES, EVENT_TYPES, type AgentEvent } from '../src/events/types.js';
import { matchesTimeWindow } from '../src/policy/conditions.js';
import { LIFECYCLE_STATES } from '../src/policy/lifecycle.js';
import { FINDING_CODES } from '../src/report/build.js';
import { loadPolicies } from '../src/policy/load.js';
import {
  ACTION_IDS,
  ANIMATION_HINTS,
  AUDIT_LEVELS,
  POLICY_DECISIONS,
  SIGNAL_DECISIONS,
} from '../src/policy/types.js';
import { validatePolicyDocument } from '../src/policy/validate.js';
import { loadSchema, schemaFiles } from '../src/schema/load.js';
import { validateSchema } from '../src/schema/validator.js';
import { BUBBLE_MAX_CHARS } from '../src/signal/build.js';

type Json = Record<string, unknown>;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const failures: string[] = [];
let checks = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition) failures.push(`${label}${detail === '' ? '' : `: ${detail}`}`);
}

/** Resolve a JSON pointer, following `$ref` hops at every step. */
function resolve(schema: unknown, pointer: string): unknown {
  let node: unknown = schema;
  for (const segment of pointer.split('/')) {
    if (segment === '') continue;
    node = followRef(schema, node);
    node = isObject(node) ? node[segment] : undefined;
  }
  return followRef(schema, node);
}

function followRef(root: unknown, node: unknown): unknown {
  let current = node;
  let guard = 0;
  while (isObject(current) && typeof current['$ref'] === 'string' && guard < 16) {
    current = resolve(root, current['$ref'].replace(/^#/, ''));
    guard += 1;
  }
  return current;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function enumOf(schema: unknown, pointer: string): unknown[] | null {
  const node = resolve(schema, pointer);
  return Array.isArray(node) ? node : null;
}

const sameList = (actual: unknown, expected: readonly string[]): boolean =>
  JSON.stringify(actual) === JSON.stringify([...expected]);

const describe = (value: unknown): string => JSON.stringify(value) ?? String(value);

// ---------------------------------------------------------------- schemas ----
for (const name of schemaFiles) {
  const schema = loadSchema(name);
  check(`schema ${name} declares $schema`, typeof schema.$schema === 'string');
  check(`schema ${name} declares $id`, typeof schema.$id === 'string');
  check(`schema ${name} has a title`, typeof schema.title === 'string');
}

const policy = loadSchema('policy');
const event = loadSchema('event');
const signal = loadSchema('signal');
const audit = loadSchema('audit');

// ------------------------------------------------ code ↔ schema agreement ---
const decisionEnum = enumOf(policy, '$defs/policy/properties/decision/enum');
check(
  'policy.schema decision enum matches POLICY_DECISIONS',
  sameList(decisionEnum, POLICY_DECISIONS),
  `schema=${describe(decisionEnum)} code=${describe(POLICY_DECISIONS)}`,
);

const signalDecisionEnum = enumOf(signal, 'properties/decision/enum');
check(
  'signal.schema decision enum matches SIGNAL_DECISIONS',
  sameList(signalDecisionEnum, SIGNAL_DECISIONS),
  `schema=${describe(signalDecisionEnum)} code=${describe(SIGNAL_DECISIONS)}`,
);

const auditLevelEnum = enumOf(policy, '$defs/policy/properties/safety/properties/audit_level/enum');
check('policy.schema audit_level enum matches AUDIT_LEVELS', sameList(auditLevelEnum, AUDIT_LEVELS), describe(auditLevelEnum));

const hintEnum = enumOf(signal, 'properties/presentation/properties/animation_hint/enum');
check('signal.schema animation_hint enum matches ANIMATION_HINTS', sameList(hintEnum, ANIMATION_HINTS), describe(hintEnum));

const actionEnum = enumOf(signal, 'properties/presentation/properties/actions/items/properties/action_id/enum');
check('signal.schema action_id enum matches ACTION_IDS', sameList(actionEnum, ACTION_IDS), describe(actionEnum));

const eventTypeEnum = enumOf(event, 'properties/type/enum');
check('event.schema type enum matches EVENT_TYPES', sameList(eventTypeEnum, EVENT_TYPES), describe(eventTypeEnum));

const sourceEnum = enumOf(event, 'properties/source/enum');
check('event.schema source enum matches EVENT_SOURCES', sameList(sourceEnum, EVENT_SOURCES), describe(sourceEnum));

const bubbleSchema = resolve(signal, 'properties/presentation/properties/bubble_text');
check(
  'signal.schema bubble_text cap matches BUBBLE_MAX_CHARS',
  isObject(bubbleSchema) && bubbleSchema['maxLength'] === BUBBLE_MAX_CHARS,
  `schema=${String(isObject(bubbleSchema) ? bubbleSchema['maxLength'] : undefined)} code=${BUBBLE_MAX_CHARS}`,
);

const auditProps = Object.keys(isObject(audit.properties) ? audit.properties : {}).sort();
const whitelist = [...AUDIT_FIELD_WHITELIST].sort();
check(
  'audit.schema fields match AUDIT_FIELD_WHITELIST',
  JSON.stringify(auditProps) === JSON.stringify(whitelist),
  `schema=${JSON.stringify(auditProps)} code=${JSON.stringify(whitelist)}`,
);

// --------------------------------------------------- negative schema checks --
const withoutRationale = {
  policy: {
    id: 'bad',
    version: 1,
    description: 'x',
    priority: 1,
    trigger: { event: 'app_switch' },
    decision: 'suggest',
    safety: { requires_approval: false, reversible: true, audit_level: 'summary' },
  },
};
check('a policy without approval but without rationale is rejected', validatePolicyDocument(withoutRationale).valid === false);

const suppressWithRationale = {
  policy: {
    id: 'ok-suppress',
    version: 1,
    description: 'x',
    priority: 1,
    trigger: { event: 'app_switch' },
    decision: 'suppress',
    action: { type: 'mute_notifications' },
    safety: { requires_approval: false, rationale: 'local only', reversible: true, audit_level: 'summary' },
  },
};
check('suppress without approval and with rationale is accepted', validatePolicyDocument(suppressWithRationale).valid === true);

check(
  'the event schema rejects an unknown event type',
  validateSchema({ type: 'nope', timestamp: new Date().toISOString() }, event).valid === false,
);

check(
  'the audit schema rejects an unknown field',
  validateSchema(
    {
      event_id: 'e',
      policy_id: 'p',
      decision: 'allow',
      signal_id: null,
      user_response: null,
      timestamp: new Date().toISOString(),
      engine_version: '0.1.0',
      degraded: false,
      reason: 'matched',
      window_title: 'secret',
    },
    audit,
  ).valid === false,
);

// The time_window grammar lives in the evaluator, so it gets an explicit check.
const probeEvent: AgentEvent = {
  id: 'probe',
  type: 'app_switch',
  timestamp: new Date().toISOString(),
  source: 'manual',
  context: { app: 'probe', project: null, language: null },
  duration_seconds: null,
  metrics: {},
  metadata: {},
};
const probeContext = { event: probeEvent, now: new Date(), timezone: 'UTC' };
check('a well-formed time_window evaluates', typeof matchesTimeWindow('09:00-12:00', probeContext) === 'boolean');

let rejectedMalformed = false;
try {
  matchesTimeWindow('9am-noon', probeContext);
} catch {
  rejectedMalformed = true;
}
check('a malformed time_window is rejected', rejectedMalformed);

// -------------------------------------------------------------- policy packs --
const packsDirectory = path.join(ROOT, 'packs');
const packs = readdirSync(packsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

check('at least one policy pack ships', packs.length > 0);

let totalPolicies = 0;
for (const pack of packs) {
  const packRoot = path.join(packsDirectory, pack);
  const manifest: unknown = parseYaml(readFileSync(path.join(packRoot, 'pack.yaml'), 'utf8'));
  check(`pack ${pack} has a name`, isObject(manifest) && typeof manifest['name'] === 'string');
  check(`pack ${pack} has a description`, isObject(manifest) && typeof manifest['description'] === 'string');
  check(`pack ${pack} declares its policies`, isObject(manifest) && Array.isArray(manifest['policies']));

  const declared = isObject(manifest) && Array.isArray(manifest['policies']) ? manifest['policies'] : [];
  const loaded = loadPolicies([path.join(packRoot, 'policies')]);
  const loadedIds = loaded.map((entry) => entry.policy.id).sort();
  check(
    `pack ${pack} manifest matches its policy files`,
    JSON.stringify([...declared].sort()) === JSON.stringify(loadedIds),
    `manifest=${JSON.stringify([...declared].sort())} files=${JSON.stringify(loadedIds)}`,
  );

  for (const entry of loaded) {
    totalPolicies += 1;
    const result = validatePolicyDocument({ policy: entry.policy }, entry.file);
    check(`policy ${entry.policy.id} is valid`, result.valid, result.issues.map((issue) => issue.code).join(','));

    if (!entry.policy.safety.requires_approval) {
      check(
        `policy ${entry.policy.id} explains why it may act without approval`,
        (entry.policy.safety.rationale ?? '').trim().length > 0,
      );
    }

    const bubble = entry.policy.presentation?.bubble_text;
    if (bubble !== undefined) {
      check(`policy ${entry.policy.id} bubble fits the pet contract`, [...bubble].length <= BUBBLE_MAX_CHARS);
    }
  }
}
check('the bundled packs ship policies', totalPolicies > 0);

// ------------------------------------------------------- docs ↔ code gates ----
/**
 * Documentation is a contract, so it gets a gate too. These checks are
 * deliberately narrow: they verify that the *facts* docs claim about the
 * system are still true, not that prose is unchanged.
 */
/**
 * Layout: `docs/en/` is the source of truth and `docs/zh-cn/` mirrors it with
 * the same filenames. This gate reads the English tree, because a fact check
 * against a translation would be checking a copy.
 */
const docsDirectory = path.join(ROOT, 'docs', 'en');
const zhDocsDirectory = path.join(ROOT, 'docs', 'zh-cn');
const readDoc = (name: string): string => readFileSync(path.join(docsDirectory, name), 'utf8');

/**
 * Every document exists in both languages. `verify-i18n` owns pairing,
 * links and drift hashes; this gate only asserts the invariant that matters
 * to the rest of the spec checks: the English document it reads is the
 * primary one, and a translation sits beside it.
 */
const EXPECTED_DOCS = [
  '00-project-brief',
  '01-prd',
  '02-architecture',
  '03-policy-lifecycle',
  '04-policy-dsl',
  '05-event-spec',
  '06-compiler-spec',
  '07-pet-bridge',
  '08-security-and-audit',
  '09-mvp-roadmap',
  '10-report-spec',
  'glossary',
  'contributing/translations',
  'contributing/review-checklist',
  'README',
];
/** Every `.md` under a tree, as paths relative to that tree. Nested pages keep their subdirectory. */
function listDocs(tree: string, base: string = tree, out: string[] = []): string[] {
  for (const entry of readdirSync(tree, { withFileTypes: true })) {
    const absolute = path.join(tree, entry.name);
    if (entry.isDirectory()) listDocs(absolute, base, out);
    else if (entry.name.endsWith('.md')) out.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return out.sort();
}

const presentDocs = listDocs(docsDirectory);
const presentZhDocs = listDocs(zhDocsDirectory);

for (const base of EXPECTED_DOCS) {
  check(`docs/en/${base}.md exists`, presentDocs.includes(`${base}.md`), `found: ${presentDocs.join(", ")}`);
  check(`docs/zh-cn/${base}.md exists`, presentZhDocs.includes(`${base}.md`));
}

// The two trees must hold the same pages. A translation that is missing a page
// is invisible to a reader who only browses the English site.
check(
  'docs/zh-cn/ mirrors docs/en/ page for page',
  JSON.stringify(presentDocs) === JSON.stringify(presentZhDocs),
  `en=${JSON.stringify(presentDocs)} zh=${JSON.stringify(presentZhDocs)}`,
);

// Every `.md` must belong to an indexed page; a stray page escapes review.
const expectedSet = new Set(EXPECTED_DOCS.map((base) => `${base}.md`));
const strays = presentDocs.filter((name) => !expectedSet.has(name));
check('docs/en/ contains no unindexed document', strays.length === 0, `strays=${JSON.stringify(strays)}`);

// Every page carries the frontmatter a docs site needs.
for (const base of EXPECTED_DOCS) {
  const text = readDoc(`${base}.md`);
  const header = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  for (const field of ['title', 'sidebar_position', 'description']) {
    check(`docs/en/${base}.md declares frontmatter "${field}"`, new RegExp(`^${field}:`, 'm').test(header));
  }
}

// The architecture doc must name every layer the boundary checker enforces.
const architecture = readDoc('02-architecture.md');
for (const layer of ['events', 'policy', 'signal', 'audit', 'gate', 'pet', 'mcp', 'compile']) {
  check(`02-architecture documents the "${layer}" layer`, architecture.includes(`src/${layer}/`) || architecture.includes(`\`${layer}\``));
}
check(
  '02-architecture names the middleware stages in execution order',
  /throttleStage\([\s\S]*?inboxStage\([\s\S]*?auditStage\(/.test(architecture),
);

// The lifecycle doc's state list must match LIFECYCLE_STATES exactly.
const lifecycleDoc = readDoc('03-policy-lifecycle.md');
for (const state of LIFECYCLE_STATES) {
  check(`03-policy-lifecycle documents state "${state}"`, lifecycleDoc.includes(`\`${state}\``));
}

// The compiler spec must document the format version actually emitted.
const compilerDoc = readDoc('06-compiler-spec.md');
check(
  '06-compiler-spec documents the shipped COMPILE_FORMAT_VERSION',
  compilerDoc.includes(`\`${COMPILE_FORMAT_VERSION}\``),
  `COMPILE_FORMAT_VERSION=${COMPILE_FORMAT_VERSION}`,
);

// Every parity issue code in src/compile/verify.ts must be documented, so a
// new failure mode cannot ship without a reader-facing explanation.
const verifySource = readFileSync(path.join(ROOT, 'src', 'compile', 'verify.ts'), 'utf8');
const issuedCodes = [...new Set([...verifySource.matchAll(/code: '([a-z_]+)'/g)].map((match) => match[1]))];
check('compiler parity defines at least one issue code', issuedCodes.length > 0);
for (const code of issuedCodes) {
  check(`06-compiler-spec documents parity code "${code}"`, compilerDoc.includes(`\`${code}\``));
}

// AGENTS.md is the contributor contract; it must point at the live doc names.
const agentsMd = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
// Paths are the live Chinese-first layout; a stale path here means a reader
// (or an agent) is sent to a file that no longer exists.
for (const reference of [
  'docs/zh-cn/02-architecture.md',
  'docs/zh-cn/04-policy-dsl.md',
  'docs/zh-cn/06-compiler-spec.md',
  'docs/zh-cn/10-report-spec.md',
]) {
  check(`AGENTS.md links ${reference}`, agentsMd.includes(reference));
}

// Version strings quoted in documentation must match the shipped constant.
// A stale example is a small lie that costs a reader real debugging time, and
// it appears in *both* language files, so `verify-i18n` cannot see it.
for (const doc of presentDocs) {
  const text = readDoc(doc);
  for (const match of text.matchAll(/agent-gate v(\d+\.\d+\.\d+)/g)) {
    check(
      `docs/${doc} quotes the shipped engine version (found v${match[1]})`,
      match[1] === ENGINE_VERSION,
      `expected v${ENGINE_VERSION}`,
    );
  }
  for (const match of text.matchAll(/"engine_version": "(\d+\.\d+\.\d+)"/g)) {
    check(
      `docs/${doc} manifest sample uses the shipped engine version (found ${match[1]})`,
      match[1] === ENGINE_VERSION,
      `expected ${ENGINE_VERSION}`,
    );
  }
}

// Every finding code the report can emit must be documented, so a new finding
// cannot ship without a reader-facing explanation.
const reportDoc = readDoc('10-report-spec.md');
check('10-report-spec defines at least one finding code', FINDING_CODES.length > 0);
for (const code of FINDING_CODES) {
  check(`10-report-spec documents finding code "${code}"`, reportDoc.includes(`\`${code}\``));
}

// The report's CLI surface is documented in its own doc and in the help text.
const cliHelp = readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
check('the CLI advertises the report command', cliHelp.includes('gate report --policy'));

// Every command the help text lists that takes an `--audit` log should be
// mentioned in the doc that specifies audit-derived output.
for (const command of ['report', 'lifecycle', 'audit']) {
  check(`10-report-spec references \`gate ${command}\``, reportDoc.includes(`gate ${command}`));
}

// The documented field whitelist must equal the object the code actually emits.
const reportSource = readFileSync(path.join(ROOT, 'src', 'report', 'build.ts'), 'utf8');

const summaryBlock = /export interface ReportSummary \{([\s\S]*?)\n\}/.exec(reportSource)?.[1] ?? '';
const summaryFields = [...summaryBlock.matchAll(/^\s{2}([a-z_]+)\s*\??:/gm)].map((match) => match[1] ?? '');
check('ReportSummary declares fields', summaryFields.length > 0);
for (const field of summaryFields) {
  check(`10-report-spec documents summary.${field}`, reportDoc.includes(`\`${field}\``));
}

const policyBlock = /export interface PolicyReport \{([\s\S]*?)\n\}/.exec(reportSource)?.[1] ?? '';
const policyFields = [...policyBlock.matchAll(/^\s{2}([a-z_]+)\s*\??:/gm)].map((match) => match[1] ?? '');
check('PolicyReport declares fields', policyFields.length > 0);
for (const field of policyFields) {
  check(`10-report-spec documents policies[].${field}`, reportDoc.includes(`\`${field}\``));
}

// The three invariants section 5 and section 8 exist to state.
check('10-report-spec states the report is a read-only projection', reportDoc.includes('read-only projection constraint'));
check('10-report-spec forbids an LLM in suggestions', reportDoc.includes('never call an LLM'));
check('10-report-spec forbids auto-application', reportDoc.includes('never apply themselves'));

// ------------------------------------------------------------ result ---
if (failures.length > 0) {
  console.error(`spec validation failed (${failures.length}/${checks}):\n`);
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  process.exit(1);
}

console.log(`spec validation passed: ${checks} checks across ${schemaFiles.length} schemas and ${totalPolicies} policies.`);
