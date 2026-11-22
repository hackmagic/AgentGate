---
title: "00 · Project brief"
sidebar_position: 1
tags: [overview]
description: "What we build, what we refuse, the success criteria, and a table of trade-offs against the initial vision."
last_updated: 2026-11-22
translation_status: complete
---

# 00 · Project brief

[中文](/00-project-brief) | English

## What we are building

An open-source **personal boundary policy runtime**. It compiles a user's working habits and boundaries
into guidance policies that any agent can execute, and presents them through low-interruption,
refusable, auditable interfaces such as an AI pet.

In one sentence: **turn "when may AI act on my computer" from a verbal agreement into an executable,
auditable policy file.**

## What we are not building

Equally important, and it is what keeps scope from spreading:

| Not building | Why |
| --- | --- |
| A capture tool (rebuilding ActivityWatch / screenpipe) | Mature tools exist; we only define a semantic superset |
| A general memory database (rebuilding Mem0 / Letta / Zep) | Orthogonal to guidance; building it would dilute the core |
| Web dashboard / team edition / non-coding scenarios | Outside the MVP, see [09-mvp-roadmap](09-mvp-roadmap.md) |
| `autonomous` behaviour by default | The default is always read-only, suggest, or require approval |

## Success criteria (MVP acceptance)

1. A real ActivityWatch event can produce an executable guidance policy;
2. That policy compiles to at least two of `AGENTS.md`, `SKILL.md` and an MCP server;
3. The pet can complete "propose → user approves or rejects → execute or stay silent" end to end;
4. Every guidance event leaves an audit record containing the trigger and any user rejection.

Where the four criteria live in the repository:

| Criterion | Location |
| --- | --- |
| 1 | `src/events/activitywatch.ts` + `packs/deep-work/policies/*.yaml` + `tests/adapters.test.ts` |
| 2 | `src/compile/` + `tests/compile.test.ts` + `tests/parity.test.ts` |
| 3 | `src/pet/` + `integrations/dsh-agent-gate-pet/` + `tests/pet.test.ts`、`tests/pet-client.test.ts` |
| 4 | `src/audit/store.ts` + `tests/gate.test.ts`, `tests/contract.test.ts` |

## Trade-offs against the initial vision

The vision in this document has not been executed literally. Where the repository now differs, this
table records what changed, why, and what it cost. A trade-off nobody wrote down is indistinguishable
from drift.

| Initial vision | What the repository now does | Why | Cost / status |
| --- | --- | --- | --- |
| The project is called `guidance-runtime`: a "personal guidance policy runtime" | It is called **AgentGate**; the CLI is `gate`, the signal is `GateSignal` | `guidance` was already taken in AI and `runtime` is a generic suffix, so the name carried none of the idea and did not search | Migration cost paid once: every import, tool name and wire noun changed. See [CHANGELOG](https://github.com/hackmagic/AgentGate/blob/main/CHANGELOG.md) |
| Three layers: event adapter → policy engine → embodiment | **Four** layers: adapters → pure core → composition (`src/gate/`) → surfaces | The "three layers" existed only in the diagram; in code, evaluation, rate limiting and auditing were welded into one `engine` façade — the hardest thing to split later | One extra concept to learn. In exchange each stage is independently replaceable and testable |
| A policy is a YAML file the engine loads | A policy also has a **lifecycle** (`draft → validated → active ⇄ muted → archived`) projected from the audit log | The vision said "refusable, auditable" but never said what happens to a policy *after* the user rejects it | One more document to read ([03](03-policy-lifecycle.md)). No second state file, so nothing new can drift |
| One policy source compiles into three shapes | Same three shapes, plus a **verifiable consistency contract**: `source_hash` *and* facts read back from the emitted text | "Runs everywhere" is marketing unless it is checkable, and a hash alone passes a renderer that silently drops a field | Compiling now needs an artifact reader per target; adding a target means adding one |
| Documents 00–08, Chinese only | Documents 00–10, **bilingual**, each pair enforced by `verify-i18n` | The code, the package metadata and GitHub are English; a Chinese-only README is a dead end for anyone arriving from search | Every doc edit is now two edits, checked in CI |
| Policy semantics live in the signature and in prose | The five semantic rules are additionally pinned by tests and by the compiler's renders | Rules that exist only in prose get violated by the next contributor | Compiler changes can now fail on a semantic rule, not just on a typo |

### Vision not yet delivered

These are gaps, not decisions. Listing them here keeps [09-mvp-roadmap](09-mvp-roadmap.md) honest.

| Vision | Reality today | What is missing |
| --- | --- | --- |
| Success criterion 3: "the pet completes propose → approve → execute end to end" | The protocol, the HTTP bridge, a client and a shipped DSH adapter all exist; **the execute step is still the adapter owner's job**, and nothing has been visually verified in a real host | A desktop-notification surface and a rendered walkthrough in a live host |
| Success criterion 1: "a **real** ActivityWatch event" | The adapter consumes an **export** (a JSON file); it never talks to a live ActivityWatch instance | A live collector, which [we deliberately do not build](05-event-spec.md) — but then "real" needs saying precisely |
| The `draft` and `archived` lifecycle states | `archived` is now reachable (`gate lifecycle --archive`); **`draft` is still library-only**, because the CLI refuses an invalid policy before it can be reported | Nothing, for `draft`: it describes a file that never loaded, so a CLI that cannot read it cannot report it |
| Distributable via `npx agent-gate` | The MCP bundle's `mcp.json` already emits `npx -y agent-gate`, but the package is **not published** to npm | A release step; until then the emitted config is aspirational |

## Core boundaries (non-negotiable)

- **The engine executes nothing**: it produces a `GateSignal`; execution happens in an adapter, after user approval.
- **The audit records no content**: nine whitelisted fields, with no window titles, screenshots, clipboard or keystrokes.
- **No copy is generated**: `bubble_text` comes from the policy file, never improvised by a model.

## Who the user is

Developers and knowledge workers who already use coding agents but lack a boundary for when those
agents may act on their machine.
