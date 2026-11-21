/**
 * dsh-agent-gate-pet — configuration, persisted beside the profile.
 *
 * Location follows the ecosystem convention already used by sibling plugins:
 * `$DSH_HOME/.<plugin>.json`, because `node_modules` is rewritten on upgrade
 * and a plugin package is not a place to keep user data.
 *
 * Merge policy: **a missing field keeps the current value.** A partial PUT — an
 * older client, a hand-written curl, a load race — must never silently reset a
 * bridge URL the user typed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** DSH data directory. */
export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

/** Config file path. */
export const CONFIG_PATH = path.join(DSH_HOME, '.dsh-agent-gate-pet.json')

/** Config version; bump when the shape breaks and migrate() handles it. */
export const CONFIG_VERSION = 1

/**
 * Defaults.
 *
 * `bridgeBase` is empty on purpose: an adapter that guesses a port will
 * silently talk to whatever else happens to be listening there. Empty means
 * "not configured", and the UI says so instead of failing quietly.
 */
export const DEFAULT_CONFIG = Object.freeze({
  v: CONFIG_VERSION,
  /** Mount the prompt surface at all. */
  enabled: true,
  /** AgentGate bridge origin, e.g. http://127.0.0.1:3778. Empty = not configured. */
  bridgeBase: '',
  /** Poll interval for pending signals, milliseconds. */
  pollIntervalMs: 1000,
  /** Show a desktop notification as well as the in-page prompt. */
  notify: true,
  /** Preferred placement of the prompt dock. */
  placement: 'composer',
})

const NUMBER_BOUNDS = {
  pollIntervalMs: [250, 30000],
}

const PLACEMENTS = new Set(['composer', 'overlay'])

/**
 * @param {boolean | unknown} value candidate
 * @param {boolean} fallback default
 * @returns {boolean} accepted value or fallback
 */
function pickBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * @param {unknown} value candidate
 * @param {number} fallback default
 * @param {[number, number]} bounds inclusive range
 * @returns {number} clamped integer
 */
function pickNumber(value, fallback, [min, max]) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(max, Math.max(min, n)))
}

/**
 * A bridge URL must be an http(s) origin. Anything else (`javascript:`,
 * `file:`, a bare path) is dropped rather than passed to fetch.
 * @param {unknown} value candidate
 * @param {string} fallback default
 * @returns {string} sanitized origin without a trailing slash
 */
function pickOrigin(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (!/^https?:\/\//i.test(trimmed)) return fallback
  try {
    const url = new URL(trimmed)
    return `${url.protocol}//${url.host}`
  } catch {
    return fallback
  }
}

/**
 * @param {unknown} value candidate
 * @param {string} fallback default
 * @returns {string} one of the accepted placements
 */
function pickPlacement(value, fallback) {
  return typeof value === 'string' && PLACEMENTS.has(value) ? value : fallback
}

/**
 * Merge untrusted input into the current config.
 * @param {Record<string, unknown>} input untrusted input
 * @param {Record<string, any>} current currently saved config
 * @returns {Record<string, any>} sanitized full config
 */
export function sanitizeConfig(input, current = DEFAULT_CONFIG) {
  const src = input && typeof input === 'object' ? input : {}
  const base = { ...DEFAULT_CONFIG, ...(current || {}) }

  return {
    v: CONFIG_VERSION,
    enabled: pickBool(src.enabled, base.enabled),
    bridgeBase: pickOrigin(src.bridgeBase, base.bridgeBase),
    pollIntervalMs: pickNumber(src.pollIntervalMs, base.pollIntervalMs, NUMBER_BOUNDS.pollIntervalMs),
    notify: pickBool(src.notify, base.notify),
    placement: pickPlacement(src.placement, base.placement),
  }
}

/**
 * Read config. A missing, corrupt or unreadable file yields defaults; a plugin
 * must never prevent the host from starting.
 * @returns {Record<string, any>} config
 */
export function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return sanitizeConfig(parsed, DEFAULT_CONFIG)
  } catch {
    return sanitizeConfig({}, DEFAULT_CONFIG)
  }
}

/**
 * Write config atomically: temp file then rename, so an interrupted write
 * cannot leave a half-written JSON file behind.
 * @param {Record<string, any>} config sanitized config
 * @returns {{ok: boolean, error?: string}} result
 */
export function writeConfig(config) {
  const body = JSON.stringify(sanitizeConfig(config, config), null, 2)
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`
  try {
    fs.mkdirSync(DSH_HOME, { recursive: true })
    fs.writeFileSync(temp, body, 'utf8')
    fs.renameSync(temp, CONFIG_PATH)
    return { ok: true }
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true })
    } catch {
      // Leftover temp files are overwritten next time.
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
