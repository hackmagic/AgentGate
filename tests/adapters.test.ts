import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { eventsFromActivityWatch, type ActivityWatchRow } from '../src/events/activitywatch.js';
import { normalizeEvent } from '../src/events/normalize.js';
import { loadPolicyDirectory, loadPolicyFile } from '../src/policy/load.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLE = path.join(REPO, 'examples', 'activitywatch-export.json');
const PACK = path.join(REPO, 'packs', 'deep-work');

function windowRow(timestamp: string, duration: number, app: string, title: string): ActivityWatchRow {
  return { timestamp, duration, data: { app, title } };
}

test('the ActivityWatch example export becomes ordered agent-gate events', () => {
  const raw: unknown = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const events = eventsFromActivityWatch(raw, { id_factory: () => 'evt' });

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'focus_block_started',
      'app_switch',
      'focus_block_ended',
      'app_switch',
      'focus_block_started',
      'focus_block_ended',
      'idle_detected',
    ],
  );

  const first = events[0];
  assert.equal(first?.timestamp, '2026-11-20T01:00:00.000Z');
  assert.equal(first?.context.app, 'Code');
  assert.equal(first?.context.project, 'agent-gate');
  assert.equal(first?.context.language, 'typescript');
  assert.equal(first?.duration_seconds, 2400);
  assert.equal(first?.source, 'activitywatch');

  const idle = events.at(-1);
  assert.equal(idle?.type, 'idle_detected');
  assert.equal(idle?.duration_seconds, 1200);
});

test('gap tolerance splits one app into separate runs', () => {
  const rows = [
    windowRow('2026-11-20T01:00:00Z', 600, 'Code', 'a.ts - demo - Visual Studio Code'),
    windowRow('2026-11-20T01:20:00Z', 600, 'Code', 'b.ts - demo - Visual Studio Code'),
  ];
  const bucket = { id: 'window', type: 'currentwindow', events: rows };
  const events = eventsFromActivityWatch(bucket, { focus_block_minutes: 25, gap_tolerance_seconds: 120 });
  assert.equal(events.length, 0, 'two 10-minute runs never reach the 25-minute focus threshold');

  const merged = eventsFromActivityWatch(bucket, { focus_block_minutes: 5, gap_tolerance_seconds: 1200 });
  assert.deepEqual(
    merged.map((event) => event.type),
    ['focus_block_started', 'focus_block_ended'],
  );
});

test('short AFK rows are ignored', () => {
  const bucket = {
    id: 'afk',
    type: 'afkstatus',
    events: [
      { timestamp: '2026-11-20T01:00:00Z', duration: 60, data: { status: 'afk' } },
      { timestamp: '2026-11-20T02:00:00Z', duration: 900, data: { status: 'afk' } },
    ],
  };
  const events = eventsFromActivityWatch(bucket, { idle_minutes: 5 });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.duration_seconds, 900);
});

test('accepts { buckets: [...] } as well as a bare bucket array', () => {
  const buckets = [
    {
      id: 'window',
      type: 'currentwindow',
      events: [windowRow('2026-11-20T01:00:00Z', 1800, 'Code', 'index.ts - demo - Visual Studio Code')],
    },
  ];
  const events = eventsFromActivityWatch({ buckets });
  assert.equal(events[0]?.type, 'focus_block_started');
});

test('rejects a non-ActivityWatch payload', () => {
  assert.throws(() => eventsFromActivityWatch({ nope: true }), (error: unknown) => {
    return (error as { code?: string }).code === 'invalid_activitywatch_export';
  });
});

test('normalizeEvent fills defaults and stamps an id', () => {
  const event = normalizeEvent(
    { type: 'app_switch', timestamp: '2026-11-20T01:00:00.000Z', source: 'manual', context: { app: 'Code' } },
    { idFactory: () => 'generated-id' },
  );

  assert.equal(event.id, 'generated-id');
  assert.equal(event.context.project, null);
  assert.equal(event.duration_seconds, null);
  assert.deepEqual(event.metrics, {});
});

test('normalizeEvent rejects an unknown event type', () => {
  assert.throws(
    () => normalizeEvent({ type: 'not_a_type', timestamp: '2026-11-20T01:00:00.000Z', source: 'manual', context: { app: 'x' } }),
    (error: unknown) => (error as { code?: string }).code === 'invalid_event',
  );
});

test('the bundled pack loads and validates', () => {
  const loaded = loadPolicyDirectory(PACK);
  assert.deepEqual(
    loaded.map((entry) => entry.policy.id),
    [
      'evening-quiet-hours',
      'idle-return-resume',
      'long-focus-stretch',
      'morning-focus-protection',
      'work-hours-notification-batch',
    ],
  );

  const morning = loaded.find((entry) => entry.policy.id === 'morning-focus-protection');
  assert.equal(morning?.policy.decision, 'require_approval');
  assert.equal(morning?.policy.safety.requires_approval, true);
});

test('duplicate policy ids fail loudly', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-gate-dupes-'));
  try {
    const single = loadPolicyFile(path.join(PACK, 'policies', 'idle-return-resume.yaml')).policy;
    for (const name of ['a.yaml', 'b.yaml']) {
      writeFileSync(path.join(directory, name), JSON.stringify({ policy: single }), 'utf8');
    }
    assert.throws(() => loadPolicyDirectory(directory), (error: unknown) => {
      return (error as { code?: string }).code === 'duplicate_policy_id';
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
