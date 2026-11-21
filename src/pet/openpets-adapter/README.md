# OpenPets adapter

`src/pet/openpets-adapter/` turns an AgentGate decision into an OpenPets
reaction and speech bubble. It is a **consumer** of OpenPets: it never modifies
the app, its plugins, or any pet package.

Read this alongside [docs/07](../docs/07-pet-bridge.md), which specifies the
embodiment contract in general; this file records only what the OpenPets
integration contract adds.

## The four clauses, and where each lives

The published contract asks four things of every integration. Each is a module
and a test group, because "we tried to comply" is not verifiable.

| Clause | Module | Test group |
| --- | --- | --- |
| Configuration is safe and reversible | `config.ts` | *clause 1* |
| Runtime is fire-and-forget | `adapter.ts` | *clause 2* |
| Speech is always safe (curated pools) | `speech.ts` | *clause 3* |
| Leases route the pet | `lease.ts` | *clause 4* |

`contract.ts` holds the numbers and enums those four depend on, taken from the
[IPC reference](https://docs.openpets.dev/ipc) and the
[integrations reference](https://docs.openpets.dev/agent-integrations) rather
than invented here. `ipc.ts` is the wire transport; `map.ts` is the decision
translation.

## Configuration is reversible

Three properties, each with a failure mode it prevents:

- **Marked.** Written entries carry `managedBy: "agent-gate"`. Without a marker,
  removal has to guess which parts of a file are ours.
- **Backed up as bytes.** When a neighbour file already exists, its *original
  text* is stored, not a reparsed object. Restoring a reparsed object reformats
  the user's file — indentation, key spacing, number formatting — and
  "reversible" quietly becomes "mostly reversible".
- **Refuse foreign files.** A config owned by something else, or one that does
  not parse, is reported and left untouched. Overwriting it would be the one
  unrecoverable thing an uninstaller can do.

```ts
import { installConfig, removeConfig, readConfig } from 'agent-gate';

installConfig(file, { enabled: true, speech: false });
readConfig(file);    // { enabled: true, reactions: true, speech: false, petId: null, managedBy: 'agent-gate' }
removeConfig(file);  // restores the previous bytes, or deletes a file we created
```

## Runtime is fire-and-forget

`dispatch()` never awaits the pet and never throws. A dropped reaction is
invisible; a blocked agent is not.

Because everything is swallowed, "the pet stopped working" would otherwise have
no signal anywhere. `stats()` carries counters and the last error for a doctor
command — never on the dispatch path.

```ts
const adapter = createOpenPetsAdapter({ transport: createIpcTransport() });

adapter.dispatch(resolveDispatch(outcome.signal, { degraded: outcome.degraded, throttled: outcome.throttled }));
adapter.stats(); // { dispatched, reactionsSent, speechesSent, skippedByCooldown, failures, lastError, ... }
await adapter.close();
```

Cooldowns follow the reference integrations: ~20s between speeches, ~3s between
reactions.

## Speech comes from a pool

Automatic messages are chosen from curated pools in `speech.ts`, never composed
from policy text.

The temptation is real: `bubble_text` is right there and already user-facing.
Sending it would leak policy internals into a channel the user did not ask to be
spoken, and would make the engine responsible for prose on a surface it does not
own. `bubble_text` still reaches the user — the prompt surface renders it.

`isSafeSpeech()` re-checks the documented rules (single line, 1–140 characters,
no URLs, paths, code or secret-like tokens) before anything is sent, and a pool
entry that fails is dropped rather than sent unchecked.

## Leases route the pet

A lease is a 15s claim kept alive by heartbeats. Three details in the reference
are the ones that actually bite, and `LeaseManager` exists mostly to get them
right once:

1. **Never lose the id on a failed heartbeat.** The failed id is stashed and
   retried as a heartbeat before any fresh acquire. Acquiring instead would
   silently re-route an explicit agent pet onto the default pet — the user's pet
   moves for no visible reason.
2. **Acquiring is idempotent per client.** Concurrent `ensure()` calls share one
   acquisition, so two events in the same tick cannot create two pets.
3. **Release exactly once.** Shutdown arrives from signals, transport close and
   unload; running the path twice must not send a second release.

## Decision mapping

`map.ts` is deliberately narrow: the engine decided *whether* to intervene, so
the adapter must not upgrade the decision while translating it.

| Engine outcome | Reaction | Speech |
| --- | --- | --- |
| `require_approval` | `waiting` | `permission` |
| `suggest` / `suppress` | `thinking` | `question` |
| plain `allow` | nothing | nothing |
| degraded evaluation | `error` | `error` |
| event-derived (no signal) | per event type | — |

A `suggest` never arrives looking like a blocked approval. A plain `allow` emits
nothing at all, or the pet would animate on every idle tick.

## Failure states

The adapter treats the pet app as optional:

| Situation | Behaviour |
| --- | --- |
| Discovery file missing | `discovery_missing`; dispatch becomes a no-op |
| App not running | connect fails fast; counted in `stats().failures` |
| Malformed discovery file | `discovery_invalid`, refused rather than guessed |
| App mid-restart (token rotated) | discovery is re-read per call, so it recovers by itself |

The token is never included in an error message or a log line.

## What this adapter does not do

- **It does not install or configure OpenPets.** It writes one small config file
  and nothing else.
- **It does not drive the pet while idle.** No reaction means no animation
  request; the app's own idle behaviour is untouched.
- **It does not speak policy copy.** See above.
- **It does not verify rendering.** The adapter is tested against a fake
  transport, not against a running app; see the limitation note in
  [docs/07](../docs/07-pet-bridge.md).
