/**
 * dsh-agent-gate-pet — host half (Node side).
 *
 * The browser half must not talk to the AgentGate bridge directly, and not for
 * an incidental reason: the bridge hands out approval prompts. Proxying through
 * the host keeps three properties that a direct call would break.
 *
 *   1. **No CORS relaxation.** The bridge binds loopback and does not need to
 *      learn about the Web UI's origin.
 *   2. **One policy for who may answer.** Only this route reaches `/respond`.
 *   3. **The prompt surface can be turned off in one place.** Disabling the
 *      plugin removes the proxy, so no page can answer a prompt.
 *
 * Routes, all loopback-only and fail-closed:
 *   GET  /agent-gate-pet/config.json
 *   PUT  /agent-gate-pet/config.json
 *   GET  /agent-gate-pet/health.json
 *   GET  /agent-gate-pet/signals.json          pending signals, proxied
 *   POST /agent-gate-pet/respond.json          { signal_id, action_id }
 *
 * It never embeds the engine and never executes an action: it forwards the
 * user's answer to the engine that already recorded the decision.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONFIG_PATH, DEFAULT_CONFIG, readConfig, sanitizeConfig, writeConfig } from './config.js'

/** Cordis plugin name. */
export const name = 'dsh-agent-gate-pet'

/** Host services this plugin needs. */
export const inject = ['webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PREFIX = '/agent-gate-pet'

/** Loopback hostnames. Anything else is refused; no optimistic DNS-rebind guess. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** Accepted actions. Mirrors ACTION_IDS in the engine; a pet cannot invent one. */
const ACTION_IDS = new Set(['approve', 'dismiss', 'mute_1h'])

const BODY_LIMIT = 64 * 1024
const UPSTREAM_TIMEOUT_MS = 5000

/**
 * @returns {string} this package's version, or 0.0.0
 */
function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const VERSION = readVersion()

/**
 * Strip the port and IPv6 brackets, lowercased.
 * @param {string | undefined} host Host header
 * @returns {string} hostname
 */
function hostnameOf(host) {
  if (typeof host !== 'string') return ''
  const trimmed = host.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(0, end + 1)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/**
 * @param {import('node:http').IncomingMessage} req request
 * @returns {boolean} whether the request came from loopback
 */
function isLoopback(req) {
  return LOOPBACK_HOSTS.has(hostnameOf(req.headers.host))
}

/**
 * @param {import('node:http').ServerResponse} res response
 * @param {number} status status code
 * @param {unknown} body payload
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

/**
 * @param {import('node:http').IncomingMessage} req request
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, status: number, error: string}>} parsed body
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) return { ok: false, status: 413, error: 'body_too_large' }
    chunks.push(chunk)
  }
  if (size === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' }
  }
}

/**
 * Call the bridge.
 * @param {string} base bridge origin
 * @param {string} route path on the bridge
 * @param {{method?: string, body?: unknown}} [options] request options
 * @returns {Promise<{ok: boolean, status: number, body: unknown}>} result
 */
async function callBridge(base, route, options = {}) {
  const method = options.method ?? 'GET'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const response = await fetch(new URL(route, base), {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: 'manual',
    })
    const text = await response.text()
    let body
    try {
      body = text.trim() === '' ? {} : JSON.parse(text)
    } catch {
      body = { error: { code: 'upstream_invalid_json', message: text.slice(0, 200) } }
    }
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: {
        error: {
          code: 'bridge_unreachable',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Plugin entry.
 * @param {any} ctx Cordis context
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    let cached = readConfig()

    webCtx.effect(
      () => {
        const disposers = [
          webCtx.webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/config.json`,
            handler: async (req, res) => {
              if (!isLoopback(req)) return sendJson(res, 403, { error: 'loopback_only' })
              const method = (req.method ?? 'GET').toUpperCase()

              if (method === 'GET' || method === 'HEAD') {
                return sendJson(res, 200, cached)
              }
              if (method !== 'PUT' && method !== 'POST' && method !== 'PATCH') {
                return sendJson(res, 405, { error: 'method_not_allowed' })
              }

              const parsed = await readJsonBody(req)
              if (!parsed.ok) return sendJson(res, parsed.status, { error: parsed.error })

              const next = sanitizeConfig(parsed.value, cached)
              const written = writeConfig(next)
              if (!written.ok) {
                // Keep the in-memory value unchanged: showing a config that was
                // never persisted is worse than showing the old one.
                return sendJson(res, 500, { error: 'config_write_failed', detail: written.error })
              }
              cached = next
              return sendJson(res, 200, cached)
            },
          }),

          webCtx.webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/health.json`,
            handler: async (req, res) => {
              if (!isLoopback(req)) return sendJson(res, 403, { error: 'loopback_only' })

              if (!cached.bridgeBase) {
                return sendJson(res, 200, {
                  ok: true,
                  name,
                  version: VERSION,
                  enabled: cached.enabled,
                  bridge: { configured: false, reachable: false, base: '' },
                })
              }

              const probe = await callBridge(cached.bridgeBase, '/healthz')
              return sendJson(res, 200, {
                ok: true,
                name,
                version: VERSION,
                enabled: cached.enabled,
                bridge: {
                  configured: true,
                  reachable: probe.ok,
                  base: cached.bridgeBase,
                  detail: probe.ok ? undefined : `HTTP ${probe.status}`,
                },
              })
            },
          }),

          webCtx.webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/signals.json`,
            handler: async (req, res) => {
              if (!isLoopback(req)) return sendJson(res, 403, { error: 'loopback_only' })
              if (!cached.enabled) return sendJson(res, 200, { signals: [] })
              if (!cached.bridgeBase) return sendJson(res, 503, { error: 'bridge_not_configured' })

              const proxied = await callBridge(cached.bridgeBase, '/v1/signals/pending')
              if (!proxied.ok) return sendJson(res, proxied.status, proxied.body)

              const signals = Array.isArray(proxied.body?.signals) ? proxied.body.signals : []
              // Re-shape nothing: the browser half renders what the engine
              // emitted, so presentation stays a policy fact, not a UI guess.
              return sendJson(res, 200, { signals })
            },
          }),

          webCtx.webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/respond.json`,
            handler: async (req, res) => {
              if (!isLoopback(req)) return sendJson(res, 403, { error: 'loopback_only' })

              const method = (req.method ?? 'GET').toUpperCase()
              if (method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
              if (!cached.enabled) return sendJson(res, 409, { error: 'plugin_disabled' })
              if (!cached.bridgeBase) return sendJson(res, 503, { error: 'bridge_not_configured' })

              const parsed = await readJsonBody(req)
              if (!parsed.ok) return sendJson(res, parsed.status, { error: parsed.error })

              const body = parsed.value && typeof parsed.value === 'object' ? parsed.value : {}
              const signalId = typeof body.signal_id === 'string' ? body.signal_id.trim() : ''
              const actionId = typeof body.action_id === 'string' ? body.action_id.trim() : ''

              if (signalId === '') return sendJson(res, 400, { error: 'missing_signal_id' })
              if (!ACTION_IDS.has(actionId)) return sendJson(res, 400, { error: 'invalid_action_id' })

              const proxied = await callBridge(
                cached.bridgeBase,
                `/v1/signals/${encodeURIComponent(signalId)}/respond`,
                {
                  method: 'POST',
                  body: { action_id: actionId, responded_at: new Date().toISOString() },
                },
              )
              return sendJson(res, proxied.status, proxied.body)
            },
          }),
        ]

        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              // One failed deregistration must not strand the others.
            }
          }
        }
      },
      'dsh-agent-gate-pet: config + health + signal proxy routes',
    )
  })
}

export default { name, inject, apply }
export { CONFIG_PATH, DEFAULT_CONFIG }
