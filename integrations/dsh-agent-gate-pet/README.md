# dsh-agent-gate-pet

Surfaces AgentGate approval prompts inside a DeepSeek Harness host.

A `GateSignal` becomes a row in the composer dock: the bubble text and the
offered actions exactly as the policy wrote them. The user presses one, and the
answer travels back to the engine, which records it. **Nothing executes here.**

This is a DSH bundle, not a change to any pet plugin. It shares no code with
`dsh-hackmagic-pets` and does not read or modify it: that package renders a 3D
pet and exposes no bubble or animation hook, so a "pet adapter" bolted into it
would have meant editing its prebuilt client bundle — which is the host kernel
by another name.

## What it does and does not do

| Does | Does not |
| --- | --- |
| Poll a running AgentGate bridge for pending signals | Embed the engine, or decide any policy |
| Show the policy's copy and actions verbatim | Generate, re-word or truncate copy |
| Send `{ signal_id, action_id }` back | Execute the action, silence notifications, or touch the OS |
| Report "no bridge configured" as a visible state | Guess a port and silently talk to whatever is listening |

## Install

1. Run an AgentGate bridge somewhere loopback-reachable:

   ```bash
   node dist/cli.js pet --policy packs/deep-work --audit ./audit.jsonl --port 3778
   ```

2. Install this bundle into the profile (from this directory):

   ```bash
   pnpm dsh plugin install ./integrations/dsh-agent-gate-pet
   ```

3. Open the settings card or write the config directly:

   ```bash
   # $DSH_HOME defaults to ~/.dsh
   cat > "$DSH_HOME/.dsh-agent-gate-pet.json" <<'JSON'
   { "enabled": true, "bridgeBase": "http://127.0.0.1:3778", "pollIntervalMs": 1000 }
   JSON
   ```

`bridgeBase` is empty by default on purpose. An adapter that guesses a port will
happily talk to whatever else is bound there, and this one dispenses approval
prompts.

## Routes

All routes are loopback-only and fail closed: a request whose `Host` header is
not `127.0.0.1`, `localhost` or `::1` receives `403` without further inspection.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/agent-gate-pet/config.json` | Current sanitized config |
| `PUT` | `/agent-gate-pet/config.json` | Merge a partial config |
| `GET` | `/agent-gate-pet/health.json` | Plugin state plus a real bridge probe |
| `GET` | `/agent-gate-pet/signals.json` | Pending signals, proxied verbatim |
| `POST` | `/agent-gate-pet/respond.json` | `{ signal_id, action_id }` |

The browser half never talks to the bridge directly. That is deliberate: a
direct call would require relaxing the bridge's CORS posture, and it would put
the ability to answer an approval prompt in the page's own origin.

## Verification

```bash
# Host half: real HTTP server over the registered routes, real AgentGate bridge
node integrations/dsh-agent-gate-pet/test/verify-host.mjs

# Browser half: the client factory driven under a stub loader and stub React
node integrations/dsh-agent-gate-pet/test/verify-client.mjs
```

Both run without a browser, without a running DSH, and without network access
beyond loopback. `npm run check` runs them.

What the checks pin, briefly: the loopback fence on every route, an invented
`action_id` being refused before it reaches the engine, an unreachable bridge
being a rendered state rather than a crash, config surviving a partial update,
and the client rendering policy copy verbatim rather than re-writing it.

## Limitations, stated plainly

- **Not visually verified.** The browser half is checked structurally (which
  slot, which elements, which props) but not rendered: no browser was driven,
  so placement, contrast in light and dark themes, and behaviour at a narrow
  viewport remain unverified.
- **No desktop notification yet.** `notify` is stored and sanitized but not
  acted on; the in-page prompt is the only surface.
- **Polling, not push.** The bridge has no event stream, so a prompt can be up
  to one poll interval late.
- **One bridge.** Configuration names a single origin; running two engines
  needs two profiles.
