---
title: "09 · Roadmap and acceptance"
sidebar_position: 10
tags: [roadmap]
description: "Real progress per milestone marked done or open, with an acceptance checklist; no aspiration."
last_updated: 2026-11-22
translation_status: complete
---

# 09 · Roadmap and acceptance

[中文](/09-mvp-roadmap) | English

Status: the **kernel** of M0–M9 has landed (v0.11.3). The table marks real progress with ✅ / ⬜, not
aspiration.

## M0 · Specifications first (done)

Delivered:

- ✅ Five contract JSON Schemas (policy/event/signal/audit/pet-contract)
- ✅ Hand-written schema subset validator plus a semantic validator (9 error codes)
- ✅ `npm run validate-specs` pins "code constants ↔ schema enums" consistency
- ✅ Documentation 00–09, split into three primary documents (runtime / lifecycle / compiler) plus an index

Acceptance: `npm run validate-specs` is green; CI fails when a spec drifts from the code.

## M1 · Policy engine and ActivityWatch adapter (done)

Delivered:

- ✅ Event normalization and the ActivityWatch adapter (focus block / app switch / idle)
- ✅ Condition evaluation (all/any/not, timezone-aware `time_window`, `day_of_week`, numeric comparison)
- ✅ Priority evaluation and the five semantic rules
- ✅ Mute state machine (3 dismissals / `mute_1h` / reset on approve)
- ✅ Content-free audit (memory + JSONL)

Acceptance: `npm test` green, with an independent test for each of the five semantic rules.

## M2 · MCP server and cross-agent compilation (done)

Delivered:

- ✅ Stateless stdio MCP server (`initialize` / `tools/list` / `tools/call` / `server/discover`)
- ✅ Three tools: `gate/evaluate`, `gate/list-policies`, `gate/audit-query`
- ✅ Three-target compilation (`AGENTS.md` / `SKILL.md` / MCP bundle) with `source_hash` consistency
- ✅ `compile-manifest.json` with per-target, per-file hashes

Acceptance: `tests/compile.test.ts` + `tests/mcp.test.ts`; all three artifacts share one `source_hash`.

## M3 · Pet adapter (partially done)

Done:

- ✅ Transport-agnostic `PetBridge` protocol
- ✅ HTTP bridge (`/healthz`, `/v1/events`, `/v1/signals/pending`, `/v1/signals/:id/respond`)
- ✅ Anti-nuisance constraints: rate limiting, no retry after dismiss, `require_approval` always offers a refusal
- ✅ Contract tests covering the full "present → approve → audit" chain
- ✅ Ephemeral ports no longer land on fetch-forbidden ports (where Node's own `fetch` refuses to connect)

Not done:

- ⬜ A real dsh-pet plugin (needs the host repository; the documentation gives the adapter shape)
- ⬜ Pet-side animation asset mapping

## M4 · Layer refactor (done)

The "three-layer flowchart" was implemented as one façade, which is exactly what made it hardest to
pull apart. This cycle took it apart:

- ✅ `src/engine.ts` façade split into `src/gate/`: `pipeline` + `throttle` + `inbox` + `audit-stage`
- ✅ The middleware chain is replaceable and observable (`gate.pipeline`); order is semantics
- ✅ `npm run lint` enforces the new four-layer dependency direction and bans a system clock in the pure core
- ✅ Fixed a real bug: an invalid `action_id` swallowed the user's pending signal

Acceptance: `tests/pipeline.test.ts` (7 cases) covering chain order, chain replacement, downgrade
auditing and signal survival.

## M5 · Lifecycle and compile consistency (done)

- ✅ `src/policy/lifecycle.ts`: audit → lifecycle projection (`draft/validated/active/muted/archived`)
- ✅ `gate lifecycle` command
- ✅ `COMPILE_FORMAT_VERSION` decoupled from the engine version
- ✅ `src/compile/verify.ts`: dual verification of identity (`source_hash`) and fidelity (facts read back from artifacts)
- ✅ `gate verify` command; `gate compile` aborts on failure
- ✅ Ten consistency error codes, each with a test

Acceptance: `tests/lifecycle.test.ts` (11 cases) + `tests/parity.test.ts` (9 cases).

## M6 · Bilingual documentation (done)

Modelled on the reference harness's documentation system:

- ✅ Every document is a pair: `&lt;name&gt;.md` English, `&lt;name&gt;.zh.md` Chinese, each linking to the other under the H1
- ✅ `npm run verify-i18n` checks pairing, mutual links and matching heading outlines
- ✅ Per-section English/Chinese hashes recorded in `docs/i18n/pairs.json`, so editing one side without
      the other fails CI instead of leaving a half-translated page
- ✅ `validate-specs` additionally asserts that the facts docs claim still hold


## M7 · Open-source release (in progress)

Done:

- ✅ README, the five-policy `deep-work` pack, sample data
- ✅ CI (typecheck / architecture / tests / spec validation / compile parity / build)
- ✅ MIT License
- ✅ CONTRIBUTING with a policy template

Remaining:

- ✅ Two more packs: `packs/health-break`, `packs/context-switch-guard`
- ⬜ npm release (`bin: gate`)
- ✅ Revision suggestions: after repeated dismissals, propose a concrete `time_window` narrowing, with the
  evidence and the caveats that limit it (see `docs/10-report-spec.md` §6)

## M8 · Reporting (done)

- ✅ `gate report`: aggregates a JSONL audit log into summary, lifecycle distribution, per-policy
  counters and findings
- ✅ Markdown output (`--format markdown`, now the default) plus `--out` and `--title`, because the
  report is usually read where it lands rather than in a terminal
- ✅ Two renderings from one `Report` object: `--format text` for humans, `--format json` for consumers
- ✅ `docs/10-report-spec.md`, with every finding code gated by `validate-specs`
- ✅ `gate lifecycle --archive &lt;id&gt;:&lt;reason&gt;`: the `archived` state is now reachable from the CLI

Fixed while building it: the engine counted dismissals but **never wrote `reason: muted`**, so a policy
the engine held muted projected as `active`. `muted` existed in `AUDIT_REASONS` and in the lifecycle
fold with nothing emitting it. There is now a regression test that builds a real log through a real gate.
## M9 · Audit depth (done)

- ✅ Two more packs: `packs/health-break` (4 policies), `packs/context-switch-guard` (4 policies)
- ✅ `npm run audit-schemas`: reports any schema keyword the hand-written validator does not implement
- ✅ `tests/schema.test.ts`: one behavioural assertion per implemented keyword, so "supported" is proven
- ✅ SKILL.md minimum usability standards in `docs/06-compiler-spec.md` §6, pinned by `tests/skill.test.ts`
- ✅ Host frontmatter limits (name ≤ 64, description ≤ 1024) written into §6.3 and enforced at the
  schema's own extremes, after a legal 64-character id produced a 75-character name
- ✅ `COMPILE_FORMAT_VERSION` 1 → 2, because the skill shape changed

Three defects this batch surfaced, all in things that looked finished:

1. `return-to-focus` was shadowed forever by `notify-free-deep-block`: same trigger, higher priority,
   overlapping window. A policy that can never fire looks like a feature and behaves like a comment.
   `tests/packs.test.ts` now probes every shipped policy at the edge of its own condition window.
2. SKILL.md told the model to send the user's answer back "through the runtime", but the MCP surface
   has **no respond tool**. The instruction described a capability that does not exist, so a model would
   either fail or claim an approval that never happened. The skill now names the real pet-bridge route
   and says what to do when no bridge is running.
3. CI hardcoded `编译格式 v1`; it now reads `format_version` from the manifest, so bumping the format
   does not require editing the workflow.

## Next priorities

Ordered by "can the community contribute", not by technical interest:

1. **Grow the policy template library** — contributing one YAML policy is far cheaper than contributing a capture engine;
2. **A real pet adapter** — get the first chain running on a real desktop;
3. ~~**Revision suggestions**~~ — delivered; the remaining idea is suggestions for a scattered pattern,
   which would need audit data the whitelist does not carry.

## Acceptance checklist (copy into a pull request)

```text
[ ] npm run check is green
[ ] New or changed policy: npm run validate-specs passes
[ ] Engine change: the five semantic rule tests still pass (tests/gate.test.ts)
[ ] Composition change: tests/pipeline.test.ts still passes
[ ] Lifecycle change: tests/lifecycle.test.ts still passes
[ ] Audit change: the injection test in tests/contract.test.ts still passes
[ ] Compile change: gate verify and tests/parity.test.ts still pass
[ ] Documentation change: npm run verify-i18n passes, both languages updated
[ ] No new capture dependency beyond ActivityWatch / screenpipe
[ ] No autonomous execution level
[ ] No I/O or system clock introduced into the pure core (npm run lint blocks it)
```
