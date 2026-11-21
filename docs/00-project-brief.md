# 00 · Project brief

English | [中文](00-project-brief.zh.md)

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
| 3 | `src/pet/` + `tests/pet.test.ts` |
| 4 | `src/audit/store.ts` + `tests/gate.test.ts`, `tests/contract.test.ts` |

## Core boundaries (non-negotiable)

- **The engine executes nothing**: it produces a `GateSignal`; execution happens in an adapter, after user approval.
- **The audit records no content**: nine whitelisted fields, with no window titles, screenshots, clipboard or keystrokes.
- **No copy is generated**: `bubble_text` comes from the policy file, never improvised by a model.

## Who the user is

Developers and knowledge workers who already use coding agents but lack a boundary for when those
agents may act on their machine.
