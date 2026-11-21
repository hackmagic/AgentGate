window.__ModuleLoader__.load({
  id: 'dsh-agent-gate-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = '/agent-gate-pet'

    /** Poll cadence comes from host config; this is only the fallback. */
    const FALLBACK_POLL_MS = 1000
    /** Never re-render a prompt for a signal answered in this page. */
    const answered = new Set()

    async function request(path, init) {
      const response = await fetch(`${BASE}${path}`, {
        ...init,
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...(init?.headers ?? {}),
        },
      })
      const text = await response.text()
      let body = {}
      try {
        body = text.trim() === '' ? {} : JSON.parse(text)
      } catch {
        body = {}
      }
      if (!response.ok) {
        const code = body?.error?.code ?? body?.error ?? `http_${response.status}`
        const error = new Error(typeof code === 'string' ? code : `http_${response.status}`)
        error.code = code
        throw error
      }
      return body
    }

    async function loadConfig() {
      try {
        return await request('/config.json')
      } catch {
        return { enabled: false, bridgeBase: '', pollIntervalMs: FALLBACK_POLL_MS, notify: false }
      }
    }

    /**
     * The prompt surface.
     *
     * It renders `presentation` verbatim, because docs/07 makes the copy a
     * policy fact: a component that rewrote the bubble text would break the
     * audit trail's correspondence with what the user actually saw.
     */
    function PromptDock() {
      const [config, setConfig] = React.useState(null)
      const [signals, setSignals] = React.useState([])
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        void loadConfig().then((next) => {
          if (!cancelled) setConfig(next)
        })
        return () => {
          cancelled = true
        }
      }, [])

      React.useEffect(() => {
        if (config === null || config.enabled !== true) return undefined

        let stopped = false
        let timer

        const tick = async () => {
          if (stopped) return
          try {
            const body = await request('/signals.json')
            const next = Array.isArray(body.signals) ? body.signals.filter((s) => !answered.has(s.id)) : []
            setSignals(next)
            setError(null)
          } catch (caught) {
            // A missing bridge is a state to display, not a crash: the user
            // configured a URL that is not running yet.
            setError(caught?.code ?? 'unreachable')
          }
          if (stopped) return
          timer = setTimeout(() => void tick(), Math.max(250, Number(config.pollIntervalMs) || FALLBACK_POLL_MS))
        }

        void tick()
        return () => {
          stopped = true
          if (timer) clearTimeout(timer)
        }
      }, [config])

      const respond = React.useCallback(
        async (signal, actionId) => {
          setBusy(signal.id)
          try {
            await request('/respond.json', {
              method: 'POST',
              body: JSON.stringify({ signal_id: signal.id, action_id: actionId }),
            })
            answered.add(signal.id)
            setSignals((current) => current.filter((entry) => entry.id !== signal.id))
            setError(null)
          } catch (caught) {
            // Kept on screen on purpose: a failed approval must not look like
            // a quiet success, or the user believes an action happened.
            setError(caught?.code ?? 'respond_failed')
          } finally {
            setBusy(null)
          }
        },
        [],
      )

      if (config === null || config.enabled !== true) return null

      const style = {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 8px',
        font: 'inherit',
      }

      if (signals.length === 0) {
        if (error === null) return null
        return h(
          'div',
          { style, role: 'status', 'aria-live': 'polite' },
          h(
            'span',
            { style: { fontSize: 11, opacity: 0.7 } },
            config.bridgeBase ? `AgentGate: ${error}` : 'AgentGate: 未配置 bridge 地址',
          ),
        )
      }

      return h(
        'div',
        { style, role: 'group', 'aria-label': 'AgentGate 提示' },
        signals.map((signal) =>
          h(
            'div',
            {
              key: signal.id,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                border: '1px solid color-mix(in srgb, currentcolor 22%, transparent)',
                borderRadius: 8,
                background: 'color-mix(in srgb, currentcolor 6%, transparent)',
              },
            },
            h('span', { style: { flex: '1 1 auto', fontSize: 12 } }, signal.presentation.bubble_text),
            signal.presentation.actions.map((action) =>
              h(
                'button',
                {
                  key: action.action_id,
                  type: 'button',
                  disabled: busy === signal.id,
                  onClick: () => void respond(signal, action.action_id),
                  style: {
                    font: 'inherit',
                    fontSize: 12,
                    padding: '3px 10px',
                    borderRadius: 6,
                    border: '1px solid color-mix(in srgb, currentcolor 25%, transparent)',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: busy === signal.id ? 'default' : 'pointer',
                    opacity: busy === signal.id ? 0.5 : 1,
                  },
                },
                action.label,
              ),
            ),
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'dsh-agent-gate-pet-prompts',
            order: 40,
          },
          PromptDock,
        ),
      )
    }

    return { inject: ['slots'], apply }
  },
})
