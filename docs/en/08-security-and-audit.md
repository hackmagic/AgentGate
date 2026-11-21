---
title: "08 · Security and audit"
sidebar_position: 9
tags: [security, reference]
description: "English | 中文(08-security-and-audit.md)"
last_updated: 2026-11-22
translation_status: complete
---

# 08 · Security and audit

English | [中文](../zh-cn/08-security-and-audit.md)

## Permission levels (four, defaulting to the most conservative)

| Level | Meaning | Who can trigger it |
| --- | --- | --- |
| `read_only` | Produce signals only; change no system state | Every policy by default |
| `suggest` | Offer advice the user may ignore | Policy declares it explicitly |
| `require_approval` | Execute an action only after explicit user approval | Policy declares it, plus user approval |
| `autonomous` | Execute without approval | **Not implemented in the MVP**: the spec keeps the field, the validator rejects it |

How `autonomous` is rejected: any policy with `requires_approval: false` must supply a `rationale` and
must not use `audit_level: none` (`missing_rationale` / `unaudited_autonomy`).

## Audit records (whitelist, nine fields)

```text
event_id  policy_id  decision  signal_id  user_response
timestamp  engine_version  degraded  reason
```

`reason` values: `matched` / `degraded` / `muted` / `rate_limited` / `user_approved` /
`user_dismissed` / `user_muted`.

### Content forbidden from the audit

- Screenshots, screen-recording frames
- Full window titles (`secret.docx — Word`)
- Clipboard contents
- Keystroke sequences
- File paths (other than configuration paths such as `policy_id` or a policy file name)

Three layers enforce this:

1. **Construction-time filtering**: `createAuditRecord()` copies whitelisted fields only, so a `window_title` in the input is dropped;
2. **Pre-write assertion**: `JsonlAuditStore.append()` calls `assertAuditRecordSafe()`, which raises `unsafe_audit_record` on any out-of-bounds field;
3. **Test pinning**: `tests/contract.test.ts` injects `screenshot` / `window_title` / `clipboard` and asserts they are stripped.

There is exactly one write path: `append()` in `src/gate/audit-stage.ts`. Auditing is the last link in
the middleware chain, so it observes the **post-downgrade** decision. That is why "rate limited" and
"muted" each get their own line instead of being missed by a second code path.

## The user's right to refuse is the core safety mechanism

Rejection data flows back into the engine and is used to:

- mute automatically (three consecutive `dismiss` responses);
- suggest a revision of the conditions.

Rejection also projects into the policy's **lifecycle state**
([03-policy-lifecycle](03-policy-lifecycle.md)): one click does not just reject this instance, it
changes how the policy is surfaced and audited from then on.

This is the line between "AI guidance" and "AI monitoring": monitoring only collects behaviour;
guidance lets the user kill an entire rule with one click.

## Threat model

| Threat | Mitigation |
| --- | --- |
| A mistaken policy over-blocks | `requires_approval: true` by default; evaluation errors degrade to `allow` |
| Model-improvised copy misleads the user | Copy can only come from the policy file; a signal has no generation entry point |
| An adapter oversteps and executes | The engine holds no execution capability; execution must happen in an adapter after approval |
| The audit leaks privacy | Nine-field whitelist + construction-time filtering + pre-write assertion |
| Records are tampered with and replayed | The MVP provides no signing; JSONL can be versioned with `git`, and a hash chain can follow |
| Event flooding | The pet bridge limits to 60 requests/minute; the engine rate limiter limits repeat presentation per policy |

## Security promises we explicitly do not make

- **No content inspection**: we never read screen content, so we cannot judge whether it is sensitive.
- **No sandbox**: the policy engine runs with the user's own permissions. It is not a security boundary; the architectural boundary is.
- **No guarantee that actions are reversible**: `reversible` states a policy's intent; the undo logic lives in the adapter.

Stating this honestly is more useful than a false promise of end-to-end security.
