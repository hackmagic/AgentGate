import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { JsonlAuditStore, MemoryAuditStore } from '../src/audit/store.js';
import { AgentGate } from '../src/gate/index.js';
import { buildReport } from '../src/report/build.js';
import { renderJson, renderMarkdown, renderText } from '../src/report/render.js';
import { makeEvent, makePolicy, NOW, TZ } from './helpers.js';

/**
 * The report is a **read-only projection**: three renderings of one `Report`
 * object, and a command that must never touch the audit log it reads.
 *
 * Both halves matter. If the renderings could disagree, a reader would not know
 * which one to believe. If the command appended, its own output would change
 * the next run's numbers — a report that quietly edits its own source.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));

function populated() {
  const audit = new MemoryAuditStore();
  let now = new Date(NOW);
  const gate = new AgentGate({
    policies: [makePolicy({ id: 'focus-guard' })],
    audit,
    clock: { now: () => now },
    timezone: TZ,
  });

  const answer = (action: 'approve' | 'dismiss') => {
    const outcome = gate.evaluate(makeEvent());
    if (outcome.signal !== null) {
      gate.respond({ signal_id: outcome.signal.id, action_id: action, responded_at: now.toISOString() });
    }
    now = new Date(now.getTime() + 31 * 60_000);
  };

  answer('approve');
  answer('dismiss');
  answer('dismiss');

  return buildReport([makePolicy({ id: 'focus-guard' })], audit.query(), { now: new Date(now) });
}

console.log('\n== markdown shape ==');

test('markdown is a document, not a padded code block', () => {
  const markdown = renderMarkdown(populated());

  // A heading a reviewer can link to.
  assert.match(markdown, /^# AgentGate report$/m);
  assert.match(markdown, /^## Summary$/m);
  assert.match(markdown, /^## Lifecycle$/m);
  assert.match(markdown, /^## Policies$/m);
  assert.match(markdown, /^## Findings$/m);

  // A real table, so a comment can be anchored to a row.
  assert.match(markdown, /^\| Metric \| Value \|$/m);
  assert.match(markdown, /^\| --- \| --- \|$/m);
  assert.match(markdown, /^\| Policy \| State \|/m);

  // Not a code fence: padded columns outside a monospace font are unreadable,
  // and nobody can comment on a line inside a fence.
  assert.equal(markdown.includes('```'), false);
});

test('markdown carries the same numbers as the other two renderings', () => {
  const report = populated();
  const markdown = renderMarkdown(report);
  const text = renderText(report);

  // Same totals, expressed differently.
  assert.ok(markdown.includes(`| Events | ${report.summary.events} |`));
  assert.ok(text.includes(`events          ${report.summary.events}`));

  assert.ok(markdown.includes(`| Approved | ${report.summary.approved} |`));
  assert.ok(text.includes(`approved        ${report.summary.approved}`));

  assert.equal(JSON.parse(renderJson(report)).summary.events, report.summary.events);
});

test('a rate with no answers renders n/a in every rendering', () => {
  const empty = buildReport([makePolicy({ id: 'never-asked' })], [], { now: new Date(NOW) });
  assert.ok(renderMarkdown(empty).includes('| Approval rate | n/a |'));
  assert.ok(renderText(empty).includes('n/a'));
  assert.equal(JSON.parse(renderJson(empty)).summary.approval_rate, null);
});

test('markdown findings name the code inline so they can be grepped', () => {
  const report = populated();
  const markdown = renderMarkdown(report);
  for (const finding of report.findings) {
    assert.ok(
      markdown.includes(`\`${finding.code}\``),
      `${finding.code} must appear inline for a reader to search for it`,
    );
  }
});

test('an empty findings list says so instead of rendering nothing', () => {
  const clean = buildReport([makePolicy({ id: 'quiet' })], [], { now: new Date(NOW) });
  assert.match(renderMarkdown(clean), /## Findings\n\nNone\./);
});

test('the title is overridable, because a report often lands beside others', () => {
  const markdown = renderMarkdown(populated(), { title: 'Deep work — week 47' });
  assert.match(markdown, /^# Deep work — week 47$/m);
});

test('the policies table can be suppressed without losing the summary', () => {
  const markdown = renderMarkdown(populated(), { include_policies: false });
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Findings/);
  assert.equal(markdown.includes('## Policies'), false);
  // The finding still names the policy on purpose: the table is a detail view,
  // but a problem that exists must still be attributable after it is hidden.
  assert.match(markdown, /`focus-guard`/);
});

test('markdown is deterministic for one report', () => {
  const report = populated();
  assert.equal(renderMarkdown(report), renderMarkdown(report));
});

console.log('\n== the command never writes the audit log ==');

test('gate report leaves the audit file byte-identical', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-gate-report-'));
  try {
    const auditFile = path.join(dir, 'audit.jsonl');

    // Produce a real audit log through a real gate.
    const gate = new AgentGate({
      policies: [makePolicy({ id: 'focus-guard' })],
      audit: new JsonlAuditStore(auditFile),
      clock: { now: () => new Date(NOW) },
      timezone: TZ,
    });
    const outcome = gate.evaluate(makeEvent());
    if (outcome.signal !== null) {
      gate.respond({ signal_id: outcome.signal.id, action_id: 'approve', responded_at: NOW });
    }

    const before = readFileSync(auditFile);
    assert.ok(before.length > 0, 'the fixture must actually have audit lines');

    execFileSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', 'report', '--policy', 'packs/deep-work', '--audit', auditFile],
      { cwd: REPO, encoding: 'utf8' },
    );

    const after = readFileSync(auditFile);
    assert.deepEqual(after, before, 'a read-only projection must not append a single byte');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--out writes the report and prints its path, without touching the log', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-gate-report-'));
  try {
    const auditFile = path.join(dir, 'audit.jsonl');
    const outFile = path.join(dir, 'report.md');

    const gate = new AgentGate({
      policies: [makePolicy({ id: 'focus-guard' })],
      audit: new JsonlAuditStore(auditFile),
      clock: { now: () => new Date(NOW) },
      timezone: TZ,
    });
    gate.evaluate(makeEvent());

    const before = readFileSync(auditFile);
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', 'report', '--policy', 'packs/deep-work', '--audit', auditFile, '--out', outFile],
      { cwd: REPO, encoding: 'utf8' },
    );

    assert.match(stdout, /report\.md/);
    const written = readFileSync(outFile, 'utf8');
    assert.match(written, /^# AgentGate report$/m);
    assert.deepEqual(readFileSync(auditFile), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the default format is markdown, because the report is meant to be shared', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-gate-report-'));
  try {
    const auditFile = path.join(dir, 'audit.jsonl');
    const gate = new AgentGate({
      policies: [makePolicy({ id: 'focus-guard' })],
      audit: new JsonlAuditStore(auditFile),
      clock: { now: () => new Date(NOW) },
      timezone: TZ,
    });
    gate.evaluate(makeEvent());

    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', 'report', '--policy', 'packs/deep-work', '--audit', auditFile],
      { cwd: REPO, encoding: 'utf8' },
    );
    assert.match(stdout, /^# AgentGate report$/m);
    assert.equal(stdout.trimStart().startsWith('AgentGate report —'), false, 'plain text must be opt-in');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

