import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { MemoryAuditStore } from '../src/audit/store.js';
import { AgentGate } from '../src/gate/index.js';
import { createPetServer, listen } from '../src/pet/http.js';
import { makeEvent, makePolicy, NOW, TZ } from './helpers.js';

/**
 * End-to-end contract tests for the DSH host adapter.
 *
 * The adapter is a plain-JS bundle loaded by a Cordis host, so it cannot be
 * imported as a module under test. This drives it the way the host does: a stub
 * Cordis context collects the routes it registers, a real HTTP server serves
 * them, and a real `AgentGate` bridge sits behind them.
 *
 * That is deliberate. A test that called the handlers directly would never
 * notice a wrong route, a missing loopback fence, or a body shape the browser
 * half cannot send.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const PLUGIN = path.join(ROOT, 'integrations', 'dsh-agent-gate-pet');
const PREFIX = '/agent-gate-pet';

/**
 * Load the plugin with an isolated `DSH_HOME`, because `config.js` resolves the
 * config path at import time. A shared home would make these tests order-dependent.
 */
async function loadPlugin() {
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-e2e-'));
  process.env.DSH_HOME = home;

  // Cache-bust so every test gets a fresh module with its own config cache.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // A Windows absolute path needs a file:// URL before the ESM loader accepts it.
  const hostUrl = pathToFileURL(path.join(PLUGIN, 'host', 'index.js')).href;
  const configUrl = pathToFileURL(path.join(PLUGIN, 'host', 'config.js')).href;
  const host = await import(`${hostUrl}?v=${stamp}`);
  const config = await import(`${configUrl}?v=${stamp}`);

  return { home, host, config, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

/** Stub Cordis context that records the routes the plugin registers. */
function stubContext(): { ctx: any; routes: any[] } {
  const routes: any[] = [];
  const ctx = {
    inject(_names: string[], callback: (webCtx: any) => void) {
      callback({
        effect(fn: () => unknown) {
          fn();
        },
        webServer: {
          register(descriptor: any) {
            routes.push(descriptor);
            return () => {
              const index = routes.indexOf(descriptor);
              if (index >= 0) routes.splice(index, 1);
            };
          },
        },
      });
    },
  };
  return { ctx, routes };
}

/** Serve the collected routes over real HTTP. */
function serve(routes: any[]) {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const route = routes.find((candidate) =>
      candidate.kind === 'exact' ? url === candidate.path : url.startsWith(candidate.path),
    );
    if (route === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    Promise.resolve(route.handler(req, res)).catch(() => {
      if (res.headersSent) return;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'handler_failed' }));
    });
  });

  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address !== null ? address.port : 0 });
    });
  });
}

interface CallResult {
  status: number;
  body: any;
}

/** One request against the plugin's routes. */
function call(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  host?: string,
): Promise<CallResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string | number> = { accept: 'application/json' };
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    if (host !== undefined) headers.host = host;

    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** Spin up a real AgentGate bridge and point the plugin at it. */
async function withBridgeAndPlugin() {
  const loaded = await loadPlugin();

  const gate = new AgentGate({
    policies: [makePolicy({
      id: 'e2e-focus',
      decision: 'require_approval',
      action: { type: 'suppress_notifications', scope: ['slack'] },
      safety: { requires_approval: true, reversible: true, audit_level: 'full' },
      presentation: {
        animation_hint: 'alert',
        bubble_text: '进入专注？',
        actions: [
          { label: '批准', action_id: 'approve' },
          { label: '忽略', action_id: 'dismiss' },
        ],
      },
    })],
    audit: new MemoryAuditStore(),
    clock: { now: () => new Date(NOW) },
    timezone: TZ,
  });

  const pet = createPetServer({ engine: gate, port: 0 });
  await listen(pet.server, '127.0.0.1', 0);

  const { ctx, routes } = stubContext();
  loaded.host.apply(ctx);
  const { server, port } = await serve(routes);

  await call(port, 'PUT', `${PREFIX}/config.json`, { bridgeBase: pet.url() });

  return {
    gate,
    pet,
    port,
    routes,
    ...loaded,
    async close() {
      await pet.close();
      await new Promise((resolve) => server.close(resolve));
      loaded.cleanup();
    },
  };
}

console.log('\n== approve: prompt appears, answer settles it ==');

test('a signal reaches the browser surface and an approval settles it', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  const outcome = env.gate.evaluate(makeEvent({ id: 'evt-dsh-approve' }));
  assert.ok(outcome.signal !== null, 'the fixture policy must surface a signal');

  const listed = await call(env.port, 'GET', `${PREFIX}/signals.json`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.signals.length, 1, 'the pending signal must be visible to the page');
  assert.equal(
    listed.body.signals[0].presentation.bubble_text,
    '进入专注？',
    'presentation is passed through verbatim, never re-worded by the adapter',
  );
  assert.equal(listed.body.signals[0].presentation.actions.length, 2, 'both offered actions must arrive');

  const signalId = listed.body.signals[0].id;
  const answered = await call(env.port, 'POST', `${PREFIX}/respond.json`, {
    signal_id: signalId,
    action_id: 'approve',
  });
  assert.equal(answered.status, 200);
  assert.equal(answered.body.action_id, 'approve');

  const after = await call(env.port, 'GET', `${PREFIX}/signals.json`);
  assert.deepEqual(after.body.signals, [], 'an answered signal leaves the queue');

  assert.ok(
    env.gate.queryAudit({}).some((record) => record.reason === 'user_approved'),
    'the approval reached the engine, not just the adapter',
  );
});

console.log('\n== dismiss: never re-prompted ==');

test('a dismissal is recorded and the engine does not immediately re-prompt', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  const first = env.gate.evaluate(makeEvent({ id: 'evt-dsh-1' }));
  assert.ok(first.signal !== null);
  await call(env.port, 'POST', `${PREFIX}/respond.json`, {
    signal_id: first.signal.id,
    action_id: 'dismiss',
  });

  assert.ok(env.gate.queryAudit({}).some((record) => record.reason === 'user_dismissed'));

  const second = env.gate.evaluate(makeEvent({ id: 'evt-dsh-2' }));
  assert.equal(second.signal, null, 'a dismissed policy must not re-prompt inside its window');

  const listed = await call(env.port, 'GET', `${PREFIX}/signals.json`);
  assert.deepEqual(listed.body.signals, [], 'nothing is offered to the page after a dismissal');
});

console.log('\n== anti-nuisance and refusal paths ==');

test('an invented action is refused before it reaches the engine', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  const outcome = env.gate.evaluate(makeEvent({ id: 'evt-dsh-refuse' }));
  assert.ok(outcome.signal !== null);

  const invented = await call(env.port, 'POST', `${PREFIX}/respond.json`, {
    signal_id: outcome.signal.id,
    action_id: 'execute_now',
  });
  assert.equal(invented.status, 400);
  assert.equal(invented.body.error, 'invalid_action_id');

  // The signal survives: a refused answer is not an answer.
  const still = await call(env.port, 'GET', `${PREFIX}/signals.json`);
  assert.equal(still.body.signals.length, 1);
});

test('a response without a signal id is refused', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  const missing = await call(env.port, 'POST', `${PREFIX}/respond.json`, { action_id: 'approve' });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'missing_signal_id');
});

test('every route refuses a non-loopback Host header', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  const probes: Array<[string, string, unknown]> = [
    ['GET', 'config.json', undefined],
    ['GET', 'health.json', undefined],
    ['GET', 'signals.json', undefined],
    ['POST', 'respond.json', { signal_id: 'x', action_id: 'approve' }],
  ];
  for (const [method, route, body] of probes) {
    const refused = await call(env.port, method, `${PREFIX}/${route}`, body, 'evil.example.com');
    assert.equal(refused.status, 403, `${route} must fail closed on a foreign Host header`);
    assert.equal(refused.body.error, 'loopback_only');
  }
});

test('a disabled plugin neither lists signals nor accepts answers', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  await call(env.port, 'PUT', `${PREFIX}/config.json`, { enabled: false });

  const listed = await call(env.port, 'GET', `${PREFIX}/signals.json`);
  assert.deepEqual(listed.body.signals, [], 'a disabled plugin shows nothing');

  const refused = await call(env.port, 'POST', `${PREFIX}/respond.json`, {
    signal_id: 'whatever',
    action_id: 'approve',
  });
  assert.equal(refused.status, 409, 'and it must not be a back door for answering');
});

console.log('\n== forbidden fields are never read ==');

test('event context never reaches the page', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  env.gate.evaluate(makeEvent({
    id: 'evt-secret',
    context: { app: 'SecretApp', project: 'confidential', language: 'rust' },
  }));

  const listed = await call(env.port, 'GET', `${PREFIX}/signals.json`);
  const wire = JSON.stringify(listed.body);
  for (const forbidden of ['SecretApp', 'confidential', 'rust']) {
    assert.equal(wire.includes(forbidden), false, `"${forbidden}" leaked to the browser half`);
  }
});

console.log('\n== configuration is reversible ==');

test('config round-trips and a partial update keeps unrelated fields', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  const before = await call(env.port, 'GET', `${PREFIX}/config.json`);
  const bridgeBase = before.body.bridgeBase;
  const pollIntervalMs = before.body.pollIntervalMs;

  await call(env.port, 'PUT', `${PREFIX}/config.json`, { enabled: false });
  const after = await call(env.port, 'GET', `${PREFIX}/config.json`);

  assert.equal(after.body.enabled, false);
  assert.equal(after.body.bridgeBase, bridgeBase, 'a partial PUT must not reset a typed URL');
  assert.equal(after.body.pollIntervalMs, pollIntervalMs);
});

test('the config file is the plugin own, and removing it restores defaults', async (t) => {
  const env = await withBridgeAndPlugin();
  t.after(() => env.close());

  // This adapter owns exactly one file and never touches a neighbour, so its
  // reversibility claim is narrower than the OpenPets one: delete our file and
  // the documented defaults come back. There is no backup to restore because
  // there is nothing of the user's to preserve.
  //
  // The store is driven through its own writer rather than through
  // `CONFIG_PATH`, because that constant is bound at import time from
  // `DSH_HOME` — reading it from a test would assert the test's import order,
  // not the adapter's behaviour.
  const { config } = env;

  const written = config.writeConfig({ ...config.DEFAULT_CONFIG, bridgeBase: 'http://127.0.0.1:3999' });
  assert.equal(written.ok, true, 'the adapter must be able to persist its own config');

  const restored = config.readConfig();
  assert.equal(restored.bridgeBase, 'http://127.0.0.1:3999', 'what we wrote is what we read back');

  rmSync(config.CONFIG_PATH, { force: true });
  const afterDelete = config.readConfig();
  assert.equal(afterDelete.bridgeBase, '', 'with the file gone the adapter reports no bridge, not a stale one');
  assert.equal(afterDelete.enabled, true, 'and falls back to documented defaults');
});

console.log('\n== what a stub host cannot establish ==');

const SKIP_REASON = 'requires a running DSH host with the client bundle loaded: a stub Cordis context '
  + 'cannot prove slot registration, React rendering, or theme and locale behaviour';

test('SKIP: the prompt dock renders inside the composer slot', { skip: SKIP_REASON }, () => {
  // Slot registration is exercised by
  // `integrations/dsh-agent-gate-pet/test/verify-client.mjs`, which drives the
  // factory under a stub loader. Actual rendering needs a browser.
});

test('SKIP: the prompt is readable in light and dark themes at 390px', { skip: SKIP_REASON }, () => {
  // Visual verification has not been performed for this bundle; it is recorded
  // as a limitation in the bundle README rather than assumed.
});
