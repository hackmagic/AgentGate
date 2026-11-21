import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentGate } from '../src/gate/index.js';
import { createPetServer, listen } from '../src/pet/http.js';
import { makePolicies } from './mcp-fixtures.js';
import { newAudit, NOW } from './helpers.js';
import { ENGINE_VERSION } from '../src/version.js';

async function startPet(options: { max_events_per_minute?: number } = {}) {
  const engine = new AgentGate({
    policies: makePolicies(),
    audit: newAudit(),
    clock: { now: () => new Date(NOW) },
    timezone: 'Asia/Shanghai',
  });
  const pet = createPetServer({ engine, port: 0, max_events_per_minute: options.max_events_per_minute });
  await listen(pet.server, '127.0.0.1', 0);
  return pet;
}

const EVENT_BODY = JSON.stringify({
  event: {
    type: 'focus_block_started',
    timestamp: NOW,
    source: 'manual',
    context: { app: 'Code', project: 'agent-gate' },
  },
});

test('the pet server exposes health and an empty pending queue', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());

  const health = (await (await fetch(`${pet.url()}/healthz`)).json()) as {
    status: string;
    engine_version: string;
    policy_count: number;
  };
  assert.equal(health.status, 'ok');
  assert.equal(health.engine_version, ENGINE_VERSION);
  assert.equal(health.policy_count, 1);

  const pending = (await (await fetch(`${pet.url()}/v1/signals/pending`)).json()) as { signals: unknown[] };
  assert.deepEqual(pending.signals, []);
});

test('an event produces a signal the pet can render, and a response settles it', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());

  const evaluate = await fetch(`${pet.url()}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-gate-now': NOW },
    body: EVENT_BODY,
  });
  assert.equal(evaluate.status, 200);

  const outcome = (await evaluate.json()) as {
    decision: string;
    policy_count: number;
    signal: { id: string; presentation: { bubble_text: string; actions: { action_id: string }[] } } | null;
  };
  assert.equal(outcome.decision, 'require_approval');
  assert.equal(outcome.signal?.presentation.bubble_text, '进入专注？');

  const signalId = outcome.signal?.id;
  assert.ok(signalId !== undefined);

  const pending = (await (await fetch(`${pet.url()}/v1/signals/pending`)).json()) as { signals: { id: string }[] };
  assert.equal(pending.signals[0]?.id, signalId);

  const respond = await fetch(`${pet.url()}/v1/signals/${encodeURIComponent(signalId)}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action_id: 'approve', responded_at: NOW }),
  });
  assert.equal(respond.status, 200);
  const settled = (await respond.json()) as { action_id: string; policy_muted: boolean };
  assert.equal(settled.action_id, 'approve');
  assert.equal(settled.policy_muted, false);

  const emptyAgain = (await (await fetch(`${pet.url()}/v1/signals/pending`)).json()) as { signals: unknown[] };
  assert.deepEqual(emptyAgain.signals, []);
});

test('a dismissal is never retried automatically', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());

  const first = (await (
    await fetch(`${pet.url()}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-gate-now': NOW },
      body: EVENT_BODY,
    })
  ).json()) as { signal: { id: string } | null };
  const signalId = first.signal?.id;
  assert.ok(signalId !== undefined);

  await fetch(`${pet.url()}/v1/signals/${encodeURIComponent(signalId)}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action_id: 'dismiss', responded_at: NOW }),
  });

  const second = (await (
    await fetch(`${pet.url()}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-gate-now': NOW },
      body: EVENT_BODY,
    })
  ).json()) as { signal: unknown; throttled: boolean };

  assert.equal(second.signal, null);
  assert.equal(second.throttled, true);
});

test('unknown signals are a 404, malformed bodies a 400', async (t) => {
  const pet = await startPet();
  t.after(() => pet.close());

  const unknown = await fetch(`${pet.url()}/v1/signals/nope/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action_id: 'approve', responded_at: NOW }),
  });
  assert.equal(unknown.status, 404);

  const badBody = await fetch(`${pet.url()}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ not json',
  });
  assert.equal(badBody.status, 400);
  const body = (await badBody.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'invalid_json');
});

test('the event endpoint is rate limited', async (t) => {
  const pet = await startPet({ max_events_per_minute: 2 });
  t.after(() => pet.close());

  const post = async () =>
    fetch(`${pet.url()}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-gate-now': NOW },
      body: EVENT_BODY,
    });

  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);

  const limited = await post();
  assert.equal(limited.status, 429);
  const body = (await limited.json()) as { error: { code: string; retry_after_seconds: number } };
  assert.equal(body.error.code, 'rate_limited');
  assert.ok(body.error.retry_after_seconds >= 1);
});
