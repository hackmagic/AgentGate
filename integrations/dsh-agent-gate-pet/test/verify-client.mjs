/**
 * Offline verification for the adapter's browser half.
 *
 * The client module is a factory registered on `window.__ModuleLoader__`, so it
 * cannot be imported directly. This loads it under a stub loader with a stub
 * `react` and a stub `slots` service, then drives the component it registers.
 *
 * What is worth pinning here, given that real rendering needs a browser:
 *   1. the module registers exactly one dock slot and exposes `inject: ['slots']`;
 *   2. the component renders policy copy **verbatim** — no rewriting, no truncation;
 *   3. it renders exactly the actions the signal offered, no more;
 *   4. pressing one posts `{ signal_id, action_id }` to the respond route;
 *   5. a disabled plugin renders nothing at all;
 *   6. an unanswered bridge renders a state, not an exception.
 *
 * Usage: node integrations/dsh-agent-gate-pet/test/verify-client.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..')
const CLIENT_SOURCE = path.join(PLUGIN_ROOT, 'client', 'index.js')

let failures = 0
function check(condition, message) {
  if (condition) {
    console.log(`  PASS  ${message}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${message}`)
  }
}

/**
 * A minimal React stand-in: hooks are stateful enough to drive the component
 * across renders, and elements are plain objects so assertions can walk them.
 *
 * `render()` resets the hook cursor but keeps state, which is what a real
 * re-render does. State is never cleared by the test — clearing it would make
 * a "configured surface renders" check pass or fail on harness plumbing rather
 * than on component behaviour.
 */
function makeReact() {
  const states = []
  const effects = []
  let cursor = 0

  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children } }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in states)) states[index] = initial
      const set = (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }
      return [states[index], set]
    },
    useEffect(fn) {
      effects.push(fn)
    },
    useCallback(fn) {
      return fn
    },
  }

  /** Advance the hook cursor; a real re-render starts hooks from the top. */
  React.__render = () => {
    cursor = 0
  }
  /** Effects registered since the last reset. */
  React.__effects = effects
  React.__drainEffects = () => effects.splice(0, effects.length)

  return React
}

/** Load the client module under a stub loader. */
function loadClientModule(fetchImpl) {
  const source = fs.readFileSync(CLIENT_SOURCE, 'utf8')

  const registered = { id: null, factory: null }
  const slots = []
  let slotService = null

  const windowStub = {
    __ModuleLoader__: {
      load(entry) {
        registered.id = entry.id
        registered.factory = entry.factory
      },
    },
  }

  const react = makeReact()
  const requireStub = (specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected module request: ${specifier}`)
  }

  // Evaluate the module body with the stub globals in scope.
  const runner = new Function('window', 'fetch', `${source}`)
  runner(windowStub, fetchImpl)

  const exportsObject = registered.factory(requireStub)

  // Drive `apply` with a stub context that records the registration.
  const ctx = {
    slots: {
      inject(name, register) {
        slots.push(name)
        register()
      },
      register(options, Component) {
        slotService = { options, Component }
      },
    },
  }
  exportsObject.apply(ctx)

  return { registered, exportsObject, slots, slotService, react }
}

/** Collect every element of a given type in a rendered tree. */
function findElements(tree, predicate, found = []) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return found
  if (Array.isArray(tree)) {
    for (const child of tree) findElements(child, predicate, found)
    return found
  }
  if (predicate(tree)) found.push(tree)
  findElements(tree.props?.children, predicate, found)
  return found
}

/** Flatten rendered text for a subtree. */
function textOf(tree) {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  return textOf(tree.props?.children)
}

const SIGNAL = {
  id: 'sig-1',
  policy_id: 'adapter-focus',
  decision: 'require_approval',
  presentation: {
    animation_hint: 'alert',
    bubble_text: '进入 50 分钟专注？',
    actions: [
      { label: '批准', action_id: 'approve' },
      { label: '忽略', action_id: 'dismiss' },
      { label: '静音 1 小时', action_id: 'mute_1h' },
    ],
  },
  action: null,
  escalation: null,
  expires_at: null,
  created_at: '2026-11-20T01:00:00.000Z',
  trigger_event_id: 'evt-1',
  audit_level: 'full',
}

const CONFIGURED = {
  enabled: true,
  bridgeBase: 'http://127.0.0.1:3778',
  pollIntervalMs: 1000,
  notify: true,
  placement: 'composer',
}

/** A fetch stub that answers the three routes the client uses. */
function makeFetch({ config = CONFIGURED, signals = [SIGNAL], onRespond } = {}) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
    const respond = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })

    if (url.endsWith('/config.json')) return respond(200, config)
    if (url.endsWith('/signals.json')) return respond(200, { signals })
    if (url.endsWith('/respond.json')) {
      const parsed = JSON.parse(init.body)
      onRespond?.(parsed)
      return respond(200, { signal_id: parsed.signal_id, action_id: parsed.action_id, muted_now: false, policy_muted: false })
    }
    return respond(404, { error: { code: 'not_found' } })
  }
  impl.calls = calls
  return impl
}

console.log('\n== module shape ==')

const shape = loadClientModule(makeFetch())
check(shape.registered.id === 'dsh-agent-gate-pet', 'the factory id matches the package name')
check(Array.isArray(shape.exportsObject.inject) && shape.exportsObject.inject.includes('slots'), 'it declares the slots service')
check(shape.slots.length === 1, 'exactly one slot is injected')
check(shape.slots[0] === 'conversation.composer.dock', 'it registers into the composer dock, which allocates space')
check(shape.slotService !== null, 'a component is registered')
check(typeof shape.slotService.Component === 'function', 'the registered value is a component')

console.log('\n== rendering the signal ==')

const satisfied = makeFetch()
const app = loadClientModule(satisfied)
const Component = app.slotService.Component
const react = app.react

/** Drive the component through one render + settle its effects. */
async function renderOnce(component, reactImpl) {
  reactImpl.__render()
  const tree = component({})
  const effects = reactImpl.__drainEffects()
  for (const effect of effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  // Let the promises the effects started resolve and call `set`.
  await new Promise((resolve) => setTimeout(resolve, 5))
  return tree
}

const cleanups = []

/**
 * Render, run the effects that render registered, let their promises settle,
 * then render again so the returned tree reflects the state they set.
 *
 * The second render is the point: a component that only loads config in an
 * effect necessarily renders `null` once, and a harness that returned that
 * first tree would report every component as blank.
 */
async function settle(component, reactImpl) {
  reactImpl.__render()
  component({})
  for (const effect of reactImpl.__drainEffects()) {
    const cleanup = effect()
    // The poll effect returns a cleanup that clears its timer. Without running
    // it, the pending setTimeout would keep this process alive forever.
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  reactImpl.__render()
  const tree = component({})
  // Stop the poll this render just scheduled before returning.
  for (const effect of reactImpl.__drainEffects()) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return tree
}

/** Run every collected cleanup so no timer outlives the check. */
function drainCleanups() {
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup()
    } catch {
      // A cleanup that throws is a finding, but not one that should hide the
      // remaining assertions.
    }
  }
}

const first = await settle(Component, react)
// Before config resolves there is nothing to draw: rendering an error would
// flash at a user whose bridge is perfectly fine.
check(first === null || first === undefined, 'nothing renders before config is known')

const second = await settle(Component, react)
check(second !== null && second !== undefined, 'a configured surface renders')

const buttons = findElements(second, (element) => element.type === 'button')
check(buttons.length === 3, `exactly the three offered actions render (saw ${buttons.length})`)

const labels = buttons.map((button) => textOf(button))
check(
  labels.join(',') === '批准,忽略,静音 1 小时',
  `action labels come from the signal, verbatim (saw ${labels.join(',')})`,
)

const text = textOf(second)
check(
  text.includes('进入 50 分钟专注？'),
  'bubble text is rendered verbatim; the adapter never re-words policy copy',
)

// `presentation.animation_hint` is a contract field. A surface that drops it
// treats half of `presentation` as optional, which no other check would see.
const hintMarks = findElements(second, (element) => element.props?.['data-animation'] !== undefined)
check(hintMarks.length === 1, `exactly one animation-hint marker renders (saw ${hintMarks.length})`)
check(
  hintMarks[0]?.props?.['data-animation'] === SIGNAL.presentation.animation_hint,
  'the marker is keyed by the policy hint, not by a guess',
)
check(hintMarks[0]?.props?.['aria-hidden'] === true, 'the decorative marker is hidden from screen readers')

drainCleanups()

console.log('\n== answering ==')

let posted = null
const answering = makeFetch({ onRespond: (body) => (posted = body) })
const answeringApp = loadClientModule(answering)
const answeringReact = answeringApp.react

const answeringCleanups = []
await settle(answeringApp.slotService.Component, answeringReact)
// Second pass: config is in state, so the poll effect registers and the tree
// now contains real buttons.
const ready = await settle(answeringApp.slotService.Component, answeringReact)

const approveButton = findElements(ready, (element) => element.type === 'button' && textOf(element) === '批准')[0]
check(approveButton !== undefined, 'the approve button is reachable')

await approveButton.props.onClick()
check(posted !== null, 'pressing a button posts to the respond route')
check(posted?.signal_id === 'sig-1', 'the posted body carries the exact signal id')
check(posted?.action_id === 'approve', 'the posted body carries the chosen action')

const respondCall = answering.calls.find((callItem) => String(callItem.url).endsWith('/respond.json'))
check(respondCall?.method === 'POST', 'the answer is posted, never sent as a query string')

console.log('\n== disabled ==')

const disabledFetch = makeFetch({ config: { ...CONFIGURED, enabled: false } })
const disabledApp = loadClientModule(disabledFetch)
await settle(disabledApp.slotService.Component, disabledApp.react)
const disabledTree = await settle(disabledApp.slotService.Component, disabledApp.react)
check(disabledTree === null, 'a disabled plugin renders nothing')
check(
  !disabledFetch.calls.some((callItem) => String(callItem.url).endsWith('/signals.json')),
  'a disabled plugin does not even poll',
)

console.log('\n== an unhappy bridge ==')

const brokenFetch = makeFetch()
const brokenImpl = async (url, init) => {
  if (String(url).endsWith('/config.json')) return brokenFetch(url, init)
  return { ok: false, status: 502, text: async () => JSON.stringify({ error: { code: 'bridge_unreachable' } }) }
}
brokenImpl.calls = brokenFetch.calls
const brokenApp = loadClientModule(brokenImpl)

let threw = null
let brokenTree = null
try {
  await settle(brokenApp.slotService.Component, brokenApp.react)
  brokenTree = await settle(brokenApp.slotService.Component, brokenApp.react)
} catch (error) {
  threw = error
}
check(threw === null, 'a broken bridge does not crash the composer dock')
check(
  brokenTree !== null && textOf(brokenTree).includes('bridge_unreachable'),
  'an unreachable bridge renders its state instead of throwing',
)

// Release every timer the components left behind before deciding the exit code.
drainCleanups()

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
