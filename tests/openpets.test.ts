import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LEASE_HEARTBEAT_MS,
  LEASE_TTL_MS,
  REACTIONS,
  SPEECH_MAX_CHARS,
  createOpenPetsAdapter,
  dispatchForEmpty,
  dispatchForSignal,
  isReaction,
  isSafeSpeech,
  pickSpeech,
  readDiscovery,
  resolveDispatch,
  runtimeForEvent,
  sanitizeConfig,
  speechPool,
} from '../src/pet/openpets-adapter/index.js';
import { installConfig, isInstalled, readConfig, removeConfig } from '../src/pet/openpets-adapter/config.js';
import { LeaseManager } from '../src/pet/openpets-adapter/lease.js';
import type { PetTransport } from '../src/pet/openpets-adapter/adapter.js';
import type { GateSignal } from '../src/signal/types.js';
import { makeEvent, NOW } from './helpers.js';

/**
 * The OpenPets integration contract has four clauses, and each is a test group
 * here: configuration is reversible, runtime is fire-and-forget, speech comes
 * from a validated pool, and leases route the pet.
 *
 * These tests run without OpenPets installed. That is deliberate: an adapter
 * whose only proof is "it worked on a machine with the app running" cannot be
 * verified in CI, and regressions land silently.
 */

function signal(overrides: Partial<GateSignal> = {}): GateSignal {
  return {
    id: 'sig-1',
    policy_id: 'p',
    decision: 'require_approval',
    presentation: {
      animation_hint: 'alert',
      bubble_text: '进入专注？',
      actions: [{ label: '好', action_id: 'approve' }],
    },
    action: null,
    escalation: null,
    expires_at: null,
    created_at: NOW,
    trigger_event_id: 'e1',
    audit_level: 'full',
    ...overrides,
  };
}

/** A transport that records calls and can be told to fail. */
function fakeTransport(options: { failReact?: boolean; failSay?: boolean; failHeartbeat?: boolean } = {}) {
  const calls: string[] = [];
  const state = { leaseCounter: 0 };
  const transport: PetTransport = {
    async acquire() {
      state.leaseCounter += 1;
      calls.push(`acquire:${state.leaseCounter}`);
      return `lease-${state.leaseCounter}`;
    },
    async heartbeat(leaseId) {
      calls.push(`heartbeat:${leaseId}`);
      if (options.failHeartbeat === true) throw new Error('heartbeat failed');
    },
    async release(leaseId) {
      calls.push(`release:${leaseId}`);
    },
    async react(reaction, leaseId) {
      calls.push(`react:${reaction}:${leaseId ?? 'none'}`);
      if (options.failReact === true) throw new Error('react failed');
    },
    async say(message, leaseId) {
      calls.push(`say:${message}:${leaseId ?? 'none'}`);
      if (options.failSay === true) throw new Error('say failed');
    },
  };
  return { transport, calls };
}

console.log('\n== clause 1: configuration is reversible ==');

test('installing into an absent path creates a marked file, and removing deletes it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-cfg-'));
  try {
    const file = path.join(dir, 'config.json');

    const installed = installConfig(file, { enabled: true });
    assert.equal(installed.ok, true);
    assert.equal(installed.created, true);
    assert.equal(installed.backedUp, false);
    assert.equal(isInstalled(file), true);

    const removed = removeConfig(file);
    assert.equal(removed.ok, true);
    assert.equal(removed.deleted, true);
    assert.equal(existsSync(file), false, 'a file we created must be deleted, not left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installing over an existing file restores the original bytes exactly', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-cfg-'));
  try {
    const file = path.join(dir, 'config.json');
    // Deliberately unusual formatting: restore must not reformat it.
    const original = '{\n  "userOwned":   [1,2,3],\n  "note": "keep me"\n}\n';
    writeFileSync(file, original, 'utf8');

    const installed = installConfig(file, { enabled: true, reactions: false });
    assert.equal(installed.ok, true);
    assert.equal(installed.backedUp, true);
    assert.equal(installed.created, false);
    assert.equal(readConfig(file).reactions, false);

    const removed = removeConfig(file);
    assert.equal(removed.ok, true);
    assert.equal(removed.restored, true);
    assert.equal(readFileSync(file, 'utf8'), original, 'the user file must come back byte for byte');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a config owned by something else is refused, not overwritten', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-cfg-'));
  try {
    const file = path.join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ config: { managedBy: 'someone-else' } }), 'utf8');

    const removed = removeConfig(file);
    assert.equal(removed.ok, false);
    assert.match(removed.error ?? '', /owned by something else/);
    assert.equal(existsSync(file), true, 'a foreign file must survive');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt file is reported, never silently replaced', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-cfg-'));
  try {
    const file = path.join(dir, 'config.json');
    writeFileSync(file, 'not json at all', 'utf8');

    const removed = removeConfig(file);
    assert.equal(removed.ok, false);
    assert.equal(readFileSync(file, 'utf8'), 'not json at all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the managed marker cannot be claimed through input', () => {
  const config = sanitizeConfig({ managedBy: 'evil', enabled: false });
  assert.equal(config.managedBy, 'agent-gate', 'an input value must never adopt another tool’s block');
  assert.equal(config.enabled, false);
});

test('a missing config reads as defaults rather than throwing', () => {
  const config = readConfig(path.join(tmpdir(), 'definitely-not-here', 'x.json'));
  assert.equal(config.enabled, true);
  assert.equal(config.managedBy, 'agent-gate');
});

console.log('\n== clause 2: runtime is fire-and-forget ==');

test('dispatch returns immediately even when the transport hangs', async () => {
  let resolveReact: (() => void) | undefined;
  const transport: PetTransport = {
    acquire: async () => 'lease-1',
    heartbeat: async () => {},
    release: async () => {},
    react: () => new Promise<void>((resolve) => { resolveReact = resolve; }),
    say: async () => {},
  };
  const adapter = createOpenPetsAdapter({ transport, now: () => 0 });

  // If this awaited the transport it would never return.
  const started = Date.now();
  adapter.dispatch({ reaction: 'thinking', speech: null });
  assert.ok(Date.now() - started < 50, 'dispatch must not block on the pet');

  resolveReact?.();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await adapter.close();
});

test('a failing transport is swallowed and counted, never thrown at the agent', async () => {
  const { transport } = fakeTransport({ failReact: true });
  const adapter = createOpenPetsAdapter({ transport, now: () => 0 });

  assert.doesNotThrow(() => adapter.dispatch({ reaction: 'working', speech: null }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await adapter.close();

  const stats = adapter.stats();
  assert.equal(stats.failures, 1, 'the failure must be visible in stats');
  assert.equal(stats.reactionsSent, 0);
  assert.match(stats.lastError ?? '', /react failed/);
});

test('cooldowns stop the pet from chattering', async () => {
  let clock = 1_000_000;
  const { transport, calls } = fakeTransport();
  const adapter = createOpenPetsAdapter({ transport, now: () => clock });

  adapter.dispatch({ reaction: 'thinking', speech: 'permission' });
  adapter.dispatch({ reaction: 'thinking', speech: 'permission' });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const reacts = calls.filter((call) => call.startsWith('react:'));
  const says = calls.filter((call) => call.startsWith('say:'));
  assert.equal(reacts.length, 1, 'a second reaction inside the cooldown must be dropped');
  assert.equal(says.length, 1, 'a second speech inside the cooldown must be dropped');
  assert.ok(adapter.stats().skippedByCooldown >= 2);

  // Past the cooldown, it speaks again.
  clock += 30_000;
  adapter.dispatch({ reaction: 'thinking', speech: 'permission' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.filter((call) => call.startsWith('say:')).length, 2);

  await adapter.close();
});

test('an empty dispatch does nothing at all', async () => {
  const { transport, calls } = fakeTransport();
  const adapter = createOpenPetsAdapter({ transport, now: () => 0 });
  adapter.dispatch({ reaction: null, speech: null });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, []);
  assert.equal(adapter.stats().dispatched, 0);
  await adapter.close();
});

test('a disabled adapter does not touch the transport', async () => {
  const { transport, calls } = fakeTransport();
  const adapter = createOpenPetsAdapter({ transport, now: () => 0, enabled: false });
  adapter.dispatch({ reaction: 'working', speech: 'thinking' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, []);
  await adapter.close();
});

test('close releases exactly once, from any number of call sites', async () => {
  const { transport, calls } = fakeTransport();
  const adapter = createOpenPetsAdapter({ transport, now: () => 0 });

  adapter.dispatch({ reaction: 'working', speech: null });
  await new Promise((resolve) => setTimeout(resolve, 10));

  await Promise.all([adapter.close(), adapter.close(), adapter.close()]);
  const releases = calls.filter((call) => call.startsWith('release:'));
  assert.equal(releases.length, 1, 'shutdown can arrive from several places; it must release once');
});

console.log('\n== clause 3: speech comes from a validated pool ==');

test('every pooled message passes the speech validator', () => {
  for (const category of ['thinking', 'success', 'error', 'permission', 'question'] as const) {
    for (const message of speechPool(category)) {
      assert.equal(isSafeSpeech(message), true, `${category}: "${message}" must be safe`);
    }
  }
});

test('a signal’s bubble_text is never sent as speech', async () => {
  // The engine's copy is user-facing in a prompt surface; sending it to a
  // bubble would leak policy internals into a channel the user did not ask for.
  const { transport, calls } = fakeTransport();
  const adapter = createOpenPetsAdapter({ transport, now: () => 0 });

  const decision = dispatchForSignal(signal({ presentation: { animation_hint: 'alert', bubble_text: '进入专注？', actions: [] } }));
  adapter.dispatch(decision);
  await new Promise((resolve) => setTimeout(resolve, 10));

  for (const call of calls.filter((entry) => entry.startsWith('say:'))) {
    assert.equal(call.includes('进入专注'), false, 'policy copy must never reach a speech bubble');
  }
  await adapter.close();
});

test('the validator rejects URLs, paths, code, secrets and multi-line text', () => {
  const rejected = [
    'see https://example.com for detail',
    'open /etc/passwd now',
    'try C:\\Users\\me\\secret.txt',
    'const x = { a: 1 }',
    'export OPENPETS_REMOTE_TOKEN=abc',
    'line one\nline two',
    'token sk-abcdefghijklmnop',
    'x'.repeat(SPEECH_MAX_CHARS + 1),
    '',
  ];
  for (const message of rejected) {
    assert.equal(isSafeSpeech(message), false, `"${message}" must be rejected`);
  }

  const accepted = ['Thinking…', 'Needs your approval.', 'Done.'];
  for (const message of accepted) {
    assert.equal(isSafeSpeech(message), true, `"${message}" must be accepted`);
  }
});

test('speech selection is deterministic, so two runs of one event agree', () => {
  assert.equal(pickSpeech('thinking', 0), pickSpeech('thinking', 0));
  assert.notEqual(pickSpeech('thinking', 0), pickSpeech('thinking', 1));
  // Wraps rather than going out of bounds.
  assert.equal(pickSpeech('thinking', 99), pickSpeech('thinking', 99 % speechPool('thinking').length));
});

console.log('\n== clause 4: leases route the pet ==');

test('concurrent ensures share one acquisition', async () => {
  const { transport, calls } = fakeTransport();
  const lease = new LeaseManager({ transport });
  const ids = await Promise.all([lease.ensure(), lease.ensure(), lease.ensure()]);

  assert.deepEqual(new Set(ids), new Set(['lease-1']), 'three events in one tick must not create three pets');
  assert.equal(calls.filter((call) => call.startsWith('acquire:')).length, 1);
  await lease.release();
});

test('a failed heartbeat keeps the id, and the next ensure recovers it', async () => {
  // This is the failure the reference docs call out: losing the id here
  // silently re-routes an explicit agent pet onto the default pet.
  let failHeartbeat = true;
  const calls: string[] = [];
  const transport: PetTransport = {
    acquire: async () => {
      calls.push('acquire');
      return 'lease-A';
    },
    heartbeat: async (id) => {
      calls.push(`heartbeat:${id}`);
      if (failHeartbeat) throw new Error('beat failed');
    },
    release: async (id) => {
      calls.push(`release:${id}`);
    },
    react: async () => {},
    say: async () => {},
  };

  const lease = new LeaseManager({ transport });
  await lease.ensure();
  const beat = await lease.heartbeat();
  assert.equal(beat, false, 'a failed heartbeat reports failure');
  assert.equal(lease.snapshot().staleLeaseId, 'lease-A', 'the id must be stashed, not dropped');

  failHeartbeat = false;
  const recovered = await lease.ensure();
  assert.equal(recovered, 'lease-A', 'recovery must reuse the stashed lease, not acquire a new pet');
  assert.equal(calls.filter((entry) => entry === 'acquire').length, 1, 'no second acquire on recovery');

  await lease.release();
});

test('a heartbeat cadence that leaves no room inside the TTL is refused', () => {
  const { transport } = fakeTransport();
  assert.throws(
    () => new LeaseManager({ transport, heartbeatMs: LEASE_TTL_MS, ttlMs: LEASE_TTL_MS }),
    /leaves no room/,
  );
  // The shipped constants do leave room.
  assert.ok(LEASE_HEARTBEAT_MS < LEASE_TTL_MS);
});

test('release after a failed heartbeat still releases the stashed id', async () => {
  const calls: string[] = [];
  const transport: PetTransport = {
    acquire: async () => 'lease-B',
    heartbeat: async () => {
      throw new Error('beat failed');
    },
    release: async (id) => {
      calls.push(`release:${id}`);
    },
    react: async () => {},
    say: async () => {},
  };

  const lease = new LeaseManager({ transport });
  await lease.ensure();
  await lease.heartbeat();
  await lease.release();

  assert.deepEqual(calls, ['release:lease-B'], 'a lease whose heartbeat failed must still be released');
});

console.log('\n== decision mapping: the adapter never upgrades a decision ==');

test('require_approval waits; suggest does not look like an approval demand', () => {
  assert.deepEqual(dispatchForSignal(signal({ decision: 'require_approval' })), {
    reaction: 'waiting',
    speech: 'permission',
  });

  const suggest = dispatchForSignal(signal({ decision: 'suggest' }));
  assert.notEqual(suggest.reaction, 'waiting', 'a suggestion must not be presented as a blocked approval');
});

test('a plain allow produces nothing, so the pet does not animate on every tick', () => {
  assert.deepEqual(dispatchForEmpty({ degraded: false, throttled: false }), { reaction: null, speech: null });
});

test('a degraded evaluation surfaces as an error, because engine health is worth seeing', () => {
  const dispatch = dispatchForEmpty({ degraded: true, throttled: false });
  assert.equal(dispatch.reaction, 'error');
});

test('a signal outranks the event-derived reaction and never merges with it', () => {
  const merged = resolveDispatch(signal({ decision: 'require_approval' }), {
    degraded: false,
    throttled: false,
    event: makeEvent({ type: 'focus_block_ended' }),
  });
  assert.equal(merged.reaction, 'waiting', 'the signal must win over "success"');
});

test('every reaction the mapper can emit is in the allowed set', () => {
  const emitted = new Set<string>();
  for (const decision of ['suggest', 'require_approval', 'suppress'] as const) {
    const dispatch = dispatchForSignal(signal({ decision }));
    if (dispatch.reaction !== null) emitted.add(dispatch.reaction);
  }
  for (const type of ['focus_block_started', 'focus_block_ended', 'app_switch', 'idle_detected', 'interruption', 'notification_received'] as const) {
    const dispatch = runtimeForEvent(makeEvent({ type }));
    if (dispatch.reaction !== null) emitted.add(dispatch.reaction);
  }

  for (const reaction of emitted) {
    assert.equal(isReaction(reaction), true, `${reaction} is not in the OpenPets reaction enum`);
    assert.ok((REACTIONS as readonly string[]).includes(reaction));
  }
});

console.log('\n== discovery file handling ==');

test('a missing discovery file is a typed unavailable state, not a crash', () => {
  assert.throws(
    () => readDiscovery(path.join(tmpdir(), 'no-such-openpets-discovery.json')),
    (error: unknown) => (error as { code?: string }).code === 'discovery_missing',
  );
});

test('a malformed discovery file is refused, and the token never appears in the message', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpets-ipc-'));
  try {
    const file = path.join(dir, 'local-ipc.json');
    writeFileSync(file, JSON.stringify({ endpoint: 123, token: 'super-secret' }), 'utf8');

    try {
      readDiscovery(file);
      assert.fail('expected a typed error');
    } catch (error) {
      const typed = error as { code?: string; message?: string };
      assert.equal(typed.code, 'discovery_invalid');
      assert.equal(String(typed.message).includes('super-secret'), false, 'a token must never be echoed');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
