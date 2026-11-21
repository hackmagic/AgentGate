# 10 · Report specification

English | [中文](10-report-spec.zh.md)

> This document answers one question: **what does `gate report` compute, and what may a consumer rely on**.
> The audit trail it reads is specified in [08-security-and-audit](08-security-and-audit.md); lifecycle
> states are specified in [03-policy-lifecycle](03-policy-lifecycle.md).

A report is a **projection of the audit log**, computed the same way the lifecycle is. It keeps no
state of its own. Everything it prints can be recomputed later from the same log and the same `now` —
which is what makes the numbers trustworthy rather than merely persistent.

## 1. Invocation

```bash
gate report --policy packs/deep-work --audit ./audit.jsonl
gate report --policy packs/deep-work --audit ./audit.jsonl --format json
gate report --policy packs/deep-work --audit ./audit.jsonl --now 2026-11-20T05:00:00Z
gate report --policy packs/deep-work --audit ./audit.jsonl --no-policies
```

| Flag | Meaning |
| --- | --- |
| `--policy <path>...` | Required. The policy set the report is *about*; policies with no history appear as `validated`. |
| `--audit <file>` | JSONL audit log. Omitted means an empty log, not an error. |
| `--format text\|json` | `text` (default) is for humans; `json` is a stable machine shape. |
| `--now <iso>` | Reference instant for bounded-mute expiry and `generated_at`. |
| `--no-policies` | Text only: drop the per-policy table, keep the summary. |
| `--archive <id>:<reason>` | Apply an operator archive before reporting. |
| `--rejection-threshold <0..1>` | When to raise `high_rejection_rate`. Default `0.5`. |
| `--throttle-threshold <n>` | When to raise `heavily_throttled`. Default `3`. |

Exit code is `0` whenever a report is produced. **Findings are information, not failures**: a policy
being muted is a fact about the user, not a broken build. A malformed flag is `2`; an unreadable audit
file is an error.

## 2. What is counted

Each count is derived from `AuditRecord.reason`, so there is exactly one source:

| Field | Derived from |
| --- | --- |
| `presented` | records with `reason: matched` — the policy surfaced to the user |
| `approved` | `reason: user_approved` |
| `dismissed` | `reason: user_dismissed` |
| `muted_short` | `reason: user_muted` (the bounded `mute_1h` window) |
| `throttled` | `reason: rate_limited` — matched but inside the presentation window |
| `degraded` | `reason: degraded` — see the attribution rule below |

`events` counts **distinct `event_id` values**, not records: one event can produce several lines.

### Two rates, and why they can be `null`

```ts
approval_rate = approved / (approved + dismissed)
rejection_rate = dismissed / (approved + dismissed)
```

Both are `null` when nobody has answered. `null` is not `0`: "no one has decided" and "everyone
refused" are opposite findings, and collapsing them into `0%` would be a lie the UI cannot undo.
The text rendering prints `n/a` and the JSON prints `null`.

### Degradation and attribution

When a policy throws, the engine degrades to `allow` and writes a line with `policy_id: 'none'`. That
is deliberate: attributing a failure to the policy that failed would mean trusting the code that just
failed.

The consequence is that a per-policy `degraded` column can never see those lines. So:

- `summary.degraded` counts every degraded line in the log — always accurate;
- `policies[].degraded` counts only lines the log actually attributes to that policy.

The asymmetry is intentional and stated here rather than hidden. A non-zero summary with all-zero
per-policy columns means "something failed, and the engine declined to guess which".

## 3. Lifecycle distribution

`lifecycle` counts the five states from [03-policy-lifecycle](03-policy-lifecycle.md):

```json
{ "draft": 0, "validated": 4, "active": 1, "muted": 0, "archived": 0 }
```

The sum always equals `summary.policies`. `draft` is reachable only through the library API
(`authoringState`), not through the CLI, because the CLI refuses invalid policies before loading them.

## 4. Findings

Findings are derived, never stored. Each disappears on its own when its condition stops holding.

| Code | Raised when | What it means |
| --- | --- | --- |
| `policy_never_presented` | A policy was evaluated (throttled or degraded) but never `matched`, or the log has history but no policy ever surfaced | The trigger is too narrow, or the presentation window swallows every match |
| `high_rejection_rate` | `rejection_rate >= threshold` **and** at least 2 dismissals | The condition is probably too broad for this user |
| `muted` | The projected state is `muted` | The user silenced it; the message names when it ends, if bounded |
| `degraded_evaluations` | Any degraded line names this policy | The policy is throwing; its conditions need a fix |
| `heavily_throttled` | `throttled >= threshold` | Matches are frequent but the window is long |

Two rules the implementation follows, both learned the hard way:

1. **An empty log raises no finding.** Absence of data is not a finding; reporting it trains people to
   ignore the section.
2. **Every code the report can emit is declared in `FINDING_CODES`**, and `validate-specs` asserts that
   each one appears in this document. A new finding cannot ship undocumented.

## 5. The JSON shape

`--format json` prints one object. Consumers may rely on the keys below and on the ordering of
`policies` (matching the `--policy` load order), but not on field order within an object.

```json
{
  "generated_at": "2026-11-20T05:00:00.000Z",
  "window": { "from": "2026-11-20T01:00:00.000Z", "to": "2026-11-20T01:30:00.000Z" },
  "summary": {
    "policies": 5,
    "policies_seen": 1,
    "events": 3,
    "presented": 3,
    "approved": 0,
    "dismissed": 3,
    "throttled": 0,
    "degraded": 0,
    "approval_rate": 0
  },
  "lifecycle": { "draft": 0, "validated": 4, "active": 0, "muted": 1, "archived": 0 },
  "policies": [
    {
      "policy_id": "morning-focus-protection",
      "state": "muted",
      "presented": 3,
      "approved": 0,
      "dismissed": 3,
      "muted_short": 0,
      "throttled": 0,
      "degraded": 0,
      "rejection_rate": 1,
      "consecutive_dismissals": 3,
      "muted_until": null,
      "first_seen": "2026-11-20T01:00:00.000Z",
      "last_seen": "2026-11-20T01:30:00.000Z"
    }
  ],
  "findings": [
    {
      "code": "high_rejection_rate",
      "policy_id": "morning-focus-protection",
      "message": "3 of 3 answers were dismissals; the condition is probably too broad"
    }
  ]
}
```

`window` is `null` for an empty log. `first_seen` / `last_seen` are `null` for a policy with no records.

## 6. Stability promise

| Promise | Meaning |
| --- | --- |
| Snapshot semantics | Two runs over the same log and the same `--now` produce identical output |
| Additive fields only | New keys may appear in a minor version; existing keys keep their meaning |
| Rates are `null`, not `0` | Changing this would be a breaking change |
| Findings are advisory | They never change the exit code |

Not promised: field **order** inside an object, and the wording of `message`. Parse `code`, which is
stable, not the prose, which is meant to be read.

## 7. What this report is not

- **Not a health check.** A report with findings is a normal report.
- **Not a privacy surface.** It reads only the nine-field audit whitelist, so it cannot leak screen
  content — by construction, not by care.
- **Not a substitute for the lifecycle command.** `gate lifecycle` shows per-policy transitions;
  `gate report` shows aggregates. Use both.
- **Not a replacement for `gate audit`.** The audit command prints raw records for a narrow query;
  the report aggregates them. When a number looks wrong, drop to `gate audit` and read the lines.
