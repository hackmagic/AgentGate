import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { assertAuditRecordSafe, createAuditRecord } from '../src/audit/store.js';
import { GuidanceEngine } from '../src/engine.js';
import { validatePolicyDocument } from '../src/policy/validate.js';
import { loadSchema, schemaFiles } from '../src/schema/load.js';
import { validateSignal } from '../src/signal/validate.js';
import { ENGINE_VERSION } from '../src/version.js';
import { makePolicies } from './mcp-fixtures.js';
import { newAudit, NOW } from './helpers.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

test('the reported engine version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { version: string };
  assert.equal(ENGINE_VERSION, pkg.version);
});

test('every contract schema is valid JSON and loadable', () => {
  assert.deepEqual([...schemaFiles].sort(), ['audit', 'event', 'pet-contract', 'policy', 'signal']);
  for (const name of schemaFiles) {
    const schema = loadSchema(name) as { $schema?: string; type?: string; $ref?: string; $defs?: Record<string, unknown> };
    assert.ok(schema !== null && typeof schema === 'object');
    const defined = schema.$ref !== undefined || schema.type !== undefined || Object.keys(schema.$defs ?? {}).length > 0;
    assert.ok(defined, `${name} defines no root shape`);
  }
});

test('a guidance signal only carries what the pet contract allows', () => {
  const engine = new GuidanceEngine({
    policies: makePolicies(),
    audit: newAudit(),
    clock: { now: () => new Date(NOW) },
    timezone: 'Asia/Shanghai',
  });
  const outcome = engine.evaluate({
    id: 'evt-contract',
    type: 'focus_block_started',
    timestamp: NOW,
    source: 'manual',
    context: { app: 'Code', project: 'guidance-runtime', language: 'typescript' },
    duration_seconds: null,
    metrics: {},
    metadata: {},
  });

  const signal = outcome.signal;
  assert.ok(signal !== null);
  assert.doesNotThrow(() => validateSignal(signal));

  assert.deepEqual(Object.keys(signal).sort(), [
    'action',
    'audit_level',
    'created_at',
    'decision',
    'escalation',
    'expires_at',
    'id',
    'policy_id',
    'presentation',
    'trigger_event_id',
  ]);
  assert.ok(signal.presentation.bubble_text.length <= 30);
  assert.ok(signal.presentation.actions.some((action) => action.action_id === 'dismiss'));
});

test('the audit record is a closed set of nine fields', () => {
  const record = createAuditRecord({
    event_id: 'evt-1',
    policy_id: 'p',
    decision: 'suggest',
    signal_id: null,
    user_response: null,
    timestamp: NOW,
    engine_version: ENGINE_VERSION,
    degraded: false,
    reason: 'matched',
    // Everything below must be dropped: audit never stores ambient context.
    screenshot: 'base64…',
    window_title: 'secret.docx — Word',
    clipboard: 'password',
  });

  assert.doesNotThrow(() => assertAuditRecordSafe(record));
  assert.equal(Object.keys(record).length, 9);
  assert.equal('screenshot' in record, false);
});

test('assertAuditRecordSafe rejects a smuggled field', () => {
  assert.throws(
    () => assertAuditRecordSafe({ event_id: 'x', window_title: 'secret' }),
    (error: unknown) => (error as { code?: string }).code === 'unsafe_audit_record',
  );
});

test('the bundled pack validates from the command line', () => {
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', 'validate', 'packs/deep-work'],
    { cwd: REPO, encoding: 'utf8' },
  );
  assert.match(output, /morning-focus-protection/);
  assert.match(output, /evening-quiet-hours/);

  const version = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--version'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.match(version, new RegExp(ENGINE_VERSION.replace(/\./g, '\\.')));
});

test('every bundled policy passes the semantic validator', () => {
  const directory = path.join(REPO, 'packs', 'deep-work', 'policies');
  const files = ['evening-quiet-hours', 'idle-return-resume', 'long-focus-stretch', 'morning-focus-protection', 'work-hours-notification-batch'];
  for (const name of files) {
    const document: unknown = parse(readFileSync(path.join(directory, `${name}.yaml`), 'utf8'));
    const result = validatePolicyDocument(document);
    assert.equal(result.valid, true, `${name}: ${result.issues.map((issue) => issue.code).join(',')}`);
  }
});
