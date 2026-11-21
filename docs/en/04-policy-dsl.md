---
title: "04 · Policy DSL specification"
sidebar_position: 5
tags: [reference, policy]
description: "This document is a contract. Implementations must obey it; tests must pin these rules."
last_updated: 2026-11-22
translation_status: complete
---

# 04 · Policy DSL specification

English | [中文](../zh-cn/04-policy-dsl.md)

> This document is a contract. Implementations must obey it; tests must pin these rules.

The DSL borrows Cedar's "binary decision plus explicit clauses" style but redesigns it as YAML for
personal guidance: non-developers should be able to read it, change it, and contribute it.

## Full field set

```yaml
policy:
  id: deep-work-protection          # ^[a-z0-9][a-z0-9._-]*$, max 64
  version: 1                        # positive integer
  description: Suppress non-urgent notifications during deep work
  priority: 100                     # integer; higher wins
  trigger:
    event: focus_block_started
    context:
      app: [code, cursor, terminal]
      project: [agent-gate]
      language: [typescript]
  conditions:                       # optional; absent means "always satisfied"
    all:
      - time_window: "09:00-12:00"
      - focus_score: "> 70"
      - day_of_week: [mon, tue, wed, thu, fri]
  decision: require_approval        # suggest | require_approval | suppress | allow
  action:
    type: suppress_notifications
    scope: [slack, discord, email]
    parameters:
      duration_minutes: 90
  escalation:
    after_minutes: 90
    action: suggest_break
    decision: suggest
  safety:
    requires_approval: true
    rationale: Silencing notifications affects communication   # required when requires_approval is false
    reversible: true
    audit_level: full                # full | summary | none
  presentation:
    animation_hint: alert            # idle_shift | stretch | alert | thinking
    bubble_text: Start a 50-minute focus block?   # at most 30 code points
    actions:
      - label: Approve
        action_id: approve           # approve | dismiss | mute_1h
```

## Condition syntax

A condition is a tree: three combinators plus leaves.

| Form | Semantics |
| --- | --- |
| `all: [...]` | Every child matches |
| `any: [...]` | At least one child matches |
| `not: {...}` | Negation |
| `{key: value}` | A leaf; multiple keys in one leaf are ANDed |

Leaf key resolution order:

| key | Semantics |
| --- | --- |
| `app` / `project` / `language` | Compared against the event `context`, case-insensitively |
| `time_window` | `HH:MM-HH:MM`, start inclusive, end exclusive, may cross midnight, interpreted in the event timezone |
| `day_of_week` | `mon..sun` (full names such as `monday` are accepted) |
| Any other key | Treated as a numeric field: `event.metrics[key]` first, then `duration_seconds`; supports `> >= < <= = == !=` string comparisons |

An unknown field **does not match** and produces a warning rather than an error — a typo must not make
the engine start intervening.

## Semantic rules (hard constraints)

### Rule 1: suppress may never act by itself

With `decision: suppress` and `requires_approval: true`, the engine may only produce
`GateSignal(decision="require_approval")`; it must not execute.

```ts
// src/policy/evaluate.ts
export function resolveDecision(policy: Policy): PolicyDecision {
  if (policy.decision === 'suppress' && policy.safety.requires_approval) return 'require_approval';
  return policy.decision;
}
```

Test: `tests/gate.test.ts` → "rule 1: suppress + requires_approval only ever asks"

### Rule 2: a policy that skips approval must explain itself

A policy with `requires_approval: false` must declare a `rationale` in `safety`, or spec validation
fails. `audit_level: none` is also forbidden: a policy that can act autonomously cannot simultaneously
be unauditable.

Test: `tests/policy.test.ts` → "rule: a policy that may act without approval needs a rationale"

### Rule 3: descending priority, first non-allow decision wins

When several policies match one event, they are evaluated by descending `priority` and the first
policy producing a non-`allow` decision ends evaluation. Ties are broken by `id` order, preserving
determinism.

Test: `tests/gate.test.ts` → "rule 3: highest priority wins…"

### Rule 4: on error, allow

Any evaluation error degrades to `allow` (do not intervene) and is audited.
**Better to guide less than to block wrongly.**

Test: `tests/gate.test.ts` → "rule 4: a broken policy degrades to allow and is audited"

### Rule 5: consecutive rejections mute

After N consecutive rejections of one policy (default 3, configurable), the engine marks it `muted` and
suggests the user revise the conditions.

`dismiss` increments the count; `approve` resets it; `mute_1h` opens a 60-minute silence window without
changing the count.

Test: `tests/gate.test.ts` → "rule 5: three consecutive dismissals mute the policy"

## Validation error codes

| code | Trigger |
| --- | --- |
| `missing_rationale` | `requires_approval: false` with no `rationale` |
| `unaudited_autonomy` | `requires_approval: false` with `audit_level: none` |
| `approval_contradiction` | `decision: require_approval` paired with `requires_approval: false` |
| `allow_with_action` | `decision: allow` that nevertheless declares an `action` |
| `missing_action` | `suppress` / `require_approval` with no `action` |
| `bubble_too_long` | `bubble_text` longer than 30 characters |
| `duplicate_action` | A repeated `action_id` in `presentation.actions` |
| `invalid_duration` | `duration_minutes` not positive |
| `invalid_version` | `version` not a positive integer |

Structural problems are reported by JSON Schema (`additionalProperties`, `required`, `enum`, …), with
field paths prefixed by `/policy/...`.

## Complete examples

See `packs/deep-work/policies/`: five policies covering all four decisions, approval and
non-approval, a cross-midnight window, numeric conditions, escalation and mute.
