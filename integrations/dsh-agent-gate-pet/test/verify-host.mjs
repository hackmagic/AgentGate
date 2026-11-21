/**
 * Offline verification for the DSH adapter's host half.
 *
 * The host half is the security boundary of this integration: it decides who
 * may read pending prompts and who may answer them. That is not something to
 * eyeball, so this drives a **real** AgentGate pet bridge and a **real** HTTP
 * server built from the routes the plugin registers under a stub Cordis
 * context.
 *
 * Asserts:
 *   1. Four routes register, and the loopback fence refuses foreign Host headers;
 *   2. An unconfigured bridge reports `configured: false` instead of guessing;
 *   3. Pending signals are proxied verbatim, with presentation untouched;
 *   4. A response reaches the engine and settles the signal;
 *   5. An invented action id is refused before it reaches the engine;
 *   6. An unreachable bridge is a reported state, not a crash;
 *   7. Config persists, sanitizes, and never loses unset fields.
 *
 * Usage: node integrations/dsh-agent-gate-pet/test/verify-host.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..')

// The config module resolves DSH_HOME at import time, so isolate it first.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-gate-pet-test-'))
process.env.DSH_HOME = sandbox

const { apply, name } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'host', 'index.js')).href)
const { CONFIG_PATH, DEFAULT_CONFIG, readConfig, sanitizeConfig, writeConfig } = await import(
  pathToFileURL(path.join(PLUGIN_ROOT, 'host', 'config.js')).href
)

let failures = 0
function check(condition, message) {
  if (condition) {
    console.log(`  PASS  ${message}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${message}`)
  }
}

/** Collect routes from a stub Cordis context. */
function makeCtx() {
  const routes = []
  const ctx = {
    inject(_names, cb) {
      cb({
        effect(fn) {
          fn()
        },
        webServer: {
          register(descriptor) {
            routes.push(descriptor)
            return () => {
              const index = routes.indexOf(descriptor)
              if (index >= 0) routes.splice(index, 1)
            }
          },
        },
      })
    },
  }
  return { ctx, routes }
}

/** Serve the registered routes over real HTTP. */
function startServer(routes) {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    const route = routes.find((candidate) =>
      candidate.kind === 'exact' ? url === candidate.path : url.startsWith(candidate.path),
    )
    if (route === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      if (res.headersSent) return
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(error) }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: address.port })
    })
  })
}

/** Raw request against the plugin's routes. */
function call(port, method, urlPath, body, host) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers = { accept: 'application/json' }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = Buffer.byteLength(payload)
    }
    if (host !== undefined) headers.host = host

    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = { raw: text }
        }
        resolve({ status: res.statusCode ?? 0, body: parsed })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

console.log('\n== config module ==')

const defaults = readConfig()
check(defaults.enabled === true, 'defaults enable the surface')
check(defaults.bridgeBase === '', 'an unconfigured bridge is empty, never a guessed port')

const merged = sanitizeConfig({ bridgeBase: 'http://127.0.0.1:3778/' }, defaults)
check(merged.bridgeBase === 'http://127.0.0.1:3778', 'a trailing slash is normalized away')

const partial = sanitizeConfig({ notify: false }, { ...DEFAULT_CONFIG, bridgeBase: 'http://127.0.0.1:3778' })
check(
  partial.bridgeBase === 'http://127.0.0.1:3778',
  'a partial update must not reset a bridge URL the user typed',
)

check(sanitizeConfig({ bridgeBase: 'javascript:alert(1)' }, defaults).bridgeBase === '', 'a non-http scheme is dropped')
check(sanitizeConfig({ pollIntervalMs: 1 }, defaults).pollIntervalMs === 250, 'poll interval is clamped low')
check(sanitizeConfig({ pollIntervalMs: 10 ** 9 }, defaults).pollIntervalMs === 30000, 'poll interval is clamped high')
check(sanitizeConfig({ placement: 'nope' }, defaults).placement === 'composer', 'an unknown placement falls back')

const written = writeConfig({ ...DEFAULT_CONFIG, bridgeBase: 'http://127.0.0.1:3999' })
check(written.ok === true, 'config writes')
check(fs.existsSync(CONFIG_PATH), 'config lands at the documented path')
check(readConfig().bridgeBase === 'http://127.0.0.1:3999', 'config round-trips')

console.log('\n== routes and the loopback fence ==')

// The plugin reads config when it loads, so start from a known-unconfigured
// state; the config tests above deliberately wrote a bridge URL.
writeConfig(DEFAULT_CONFIG)

const { ctx, routes } = makeCtx()
apply(ctx)
const { server, port } = await startServer(routes)

check(routes.length === 4, `four routes register (saw ${routes.length})`)

const foreign = await call(port, 'GET', '/agent-gate-pet/config.json', undefined, 'evil.example.com')
check(foreign.status === 403, 'a non-loopback Host header is refused on config')

const foreignSignals = await call(port, 'GET', '/agent-gate-pet/signals.json', undefined, '10.0.0.5:3023')
check(foreignSignals.status === 403, 'a non-loopback Host header is refused on signals')

const foreignRespond = await call(
  port,
  'POST',
  '/agent-gate-pet/respond.json',
  { signal_id: 'x', action_id: 'approve' },
  'evil.example.com',
)
check(foreignRespond.status === 403, 'a non-loopback Host header is refused on respond')

console.log('\n== unconfigured bridge ==')

const health = await call(port, 'GET', '/agent-gate-pet/health.json')
check(health.status === 200, 'health answers without a bridge')
check(health.body?.bridge?.configured === false, 'health reports the bridge as unconfigured')
check(health.body?.bridge?.reachable === false, 'unconfigured is not reported as reachable')

const noBridge = await call(port, 'GET', '/agent-gate-pet/signals.json')
check(noBridge.status === 503, 'signals refuse explicitly when no bridge is configured')
check(noBridge.body?.error === 'bridge_not_configured', 'the refusal names the reason')

console.log('\n== against a real AgentGate bridge ==')

const { AgentGate, createPetServer, listen, MemoryAuditStore } = await import(pathToFileURL(path.join(REPO_ROOT, 'dist', 'index.js')).href)

const policy = {
  id: 'adapter-focus',
  version: 1,
  description: '专注块开始时请求批准静默通知',
  priority: 50,
  trigger: { event: 'focus_block_started' },
  decision: 'require_approval',
  action: { type: 'suppress_notifications', scope: ['slack'], parameters: { duration_minutes: 25 } },
  safety: { requires_approval: true, reversible: true, audit_level: 'full' },
  presentation: {
    animation_hint: 'alert',
    bubble_text: '进入专注？',
    actions: [
      { label: '批准', action_id: 'approve' },
      { label: '忽略', action_id: 'dismiss' },
    ],
  },
}

const NOW = '2026-11-20T01:00:00.000Z'
const gate = new AgentGate({
  policies: [policy],
  audit: new MemoryAuditStore(),
  clock: { now: () => new Date(NOW) },
  timezone: 'Asia/Shanghai',
})
const pet = createPetServer({ engine: gate, port: 0 })
await listen(pet.server, '127.0.0.1', 0)

// Point the plugin at the real bridge.
const configured = await call(port, 'PUT', '/agent-gate-pet/config.json', { bridgeBase: pet.url() })
check(configured.status === 200, 'the bridge URL is accepted')
check(configured.body?.bridgeBase === pet.url(), 'the stored URL matches what the bridge bound')

const reachable = await call(port, 'GET', '/agent-gate-pet/health.json')
check(reachable.body?.bridge?.configured === true, 'health now reports configured')
check(reachable.body?.bridge?.reachable === true, 'health probes the bridge for real')

// Submit an event straight to the bridge; the adapter should see it.
const outcome = await gate.evaluate({
  id: 'evt-adapter',
  type: 'focus_block_started',
  timestamp: NOW,
  source: 'manual',
  context: { app: 'Code', project: 'agent-gate', language: 'typescript' },
  duration_seconds: null,
  metrics: {},
  metadata: {},
})
assert.ok(outcome.signal !== null)

const pending = await call(port, 'GET', '/agent-gate-pet/signals.json')
check(pending.status === 200, 'pending signals are proxied')
check(pending.body?.signals?.length === 1, 'the pending signal is visible through the adapter')
check(
  pending.body?.signals?.[0]?.presentation?.bubble_text === '进入专注？',
  'presentation is passed through verbatim, not re-worded by the adapter',
)
check(
  Array.isArray(pending.body?.signals?.[0]?.presentation?.actions) &&
    pending.body.signals[0].presentation.actions.length === 2,
  'the offered actions arrive intact',
)

const signalId = pending.body.signals[0].id

console.log('\n== refusal paths ==')

const invented = await call(port, 'POST', '/agent-gate-pet/respond.json', {
  signal_id: signalId,
  action_id: 'execute_now',
})
check(invented.status === 400, 'an invented action is refused')
check(invented.body?.error === 'invalid_action_id', 'the refusal names invalid_action_id')

const missing = await call(port, 'POST', '/agent-gate-pet/respond.json', { action_id: 'approve' })
check(missing.status === 400, 'a response without a signal id is refused')

const unknown = await call(port, 'POST', '/agent-gate-pet/respond.json', {
  signal_id: 'no-such-signal',
  action_id: 'approve',
})
check(unknown.status === 404, 'an unknown signal id is refused by the engine, surfaced as 404')

console.log('\n== a real answer settles the signal ==')

const answered = await call(port, 'POST', '/agent-gate-pet/respond.json', {
  signal_id: signalId,
  action_id: 'approve',
})
check(answered.status === 200, 'a valid answer is accepted')
check(answered.body?.action_id === 'approve', 'the engine echoes the recorded action')

const after = await call(port, 'GET', '/agent-gate-pet/signals.json')
check(after.body?.signals?.length === 0, 'the answered signal leaves the pending queue')

const audit = gate.queryAudit({})
check(
  audit.some((record) => record.reason === 'user_approved' && record.policy_id === 'adapter-focus'),
  'the approval is in the audit trail',
)
check(
  audit.every((record) => Object.keys(record).length === 9),
  'the adapter did not widen the audit record',
)

console.log('\n== an unreachable bridge is a state, not a crash ==')

const deadPort = await new Promise((resolve) => {
  const probe = http.createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address()
    probe.close(() => resolve(free))
  })
})
await call(port, 'PUT', '/agent-gate-pet/config.json', { bridgeBase: `http://127.0.0.1:${deadPort}` })

const deadHealth = await call(port, 'GET', '/agent-gate-pet/health.json')
check(deadHealth.body?.bridge?.configured === true, 'a configured-but-dead bridge still reports configured')
check(deadHealth.body?.bridge?.reachable === false, 'and reports not reachable')

const deadSignals = await call(port, 'GET', '/agent-gate-pet/signals.json')
check(deadSignals.status === 502, 'signals report the bridge as unreachable')
check(deadSignals.body?.error?.code === 'bridge_unreachable', 'the error code says what happened')

console.log('\n== disposal ==')

await pet.close()
await new Promise((resolve) => server.close(resolve))
fs.rmSync(sandbox, { recursive: true, force: true })

check(name === 'dsh-agent-gate-pet', 'the plugin exports its name')

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
