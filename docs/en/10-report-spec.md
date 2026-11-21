---
title: "10 · Report specification"
sidebar_position: 11
tags: [reference, report]
description: "This document answers one question: what does gate report compute, and what may a consumer rely on."
last_updated: 2026-11-22
translation_status: complete
---

# 10 · Report specification

[中文](/10-report-spec) | English

> This document answers one question: **what does `gate report` compute, and what may a consumer rely on**.
> The audit trail it reads is specified in [08-security-and-audit](08-security-and-audit.md); lifecycle
> states are specified in [03-policy-lifecycle](03-policy-lifecycle.md).

A report is a **projection of the audit log**, computed the same way the lifecycle is. It keeps no
state of its own. Everything it prints can be recomputed later from the same log and the same `now` —
which is what makes the numbers trustworthy rather than merely persistent.

## 1. Invocation

```bash
gate report --policy packs/deep-work --audit ./audit.jsonl
gate report --policy packs/deep-work --audit ./audit.jsonl --out report.md
gate report --policy packs/deep-work --audit ./audit.jsonl --format json
gate report --policy packs/deep-work --audit ./audit.jsonl --format text
gate report --policy packs/deep-work --audit ./audit.jsonl --now 2026-11-20T05:00:00Z
gate report --policy packs/deep-work --audit ./audit.jsonl --no-policies
```

| Flag | Meaning |
| --- | --- |
| `--policy <path>...` | Required. The policy set the report is *about*; policies with no history appear as `validated`. |
| `--audit &lt;file&gt;` | JSONL audit log. Omitted means an empty log, not an error. |
| `--format markdown\|text\|json` | `markdown` (default) is for sharing; `text` is for a terminal; `json` is a stable machine shape. |
| `--out &lt;file&gt;` | Write the report to a file and print its path, instead of stdout. |
| `--title &lt;heading&gt;` | Markdown only: the document's H1. Defaults to `AgentGate report`. |
| `--now &lt;iso&gt;` | Reference instant for bounded-mute expiry and `generated_at`. |
| `--no-policies` | Drop the per-policy table, keep the summary and findings. |
| `--archive &lt;id&gt;:&lt;reason&gt;` | Apply an operator archive before reporting. |
| `--rejection-threshold <0..1>` | When to raise `high_rejection_rate`. Default `0.5`. |
| `--throttle-threshold &lt;n&gt;` | When to raise `heavily_throttled`. Default `3`. |
| `--timezone &lt;tz&gt;` | IANA zone used to bucket dismissal times for suggestions. |

Exit code is `0` whenever a report is produced. **Findings are information, not failures**: a policy
being muted is a fact about the user, not a broken build. A malformed flag is `2`; an unreadable audit
file is an error.

### The report never writes the audit log

The report is a **read-only projection**. It opens the audit file, reads it, and closes it. There is no
path by which `gate report` appends a record.

That is a hard rule rather than a tidiness preference: a command that both read and wrote the log would
change its own next output. The second run would count the first run's lines, and the numbers would
drift for no reason the user could see. `tests/report-render.test.ts` asserts byte equality of the audit
file before and after a report.

## 2. Format: why `markdown` is the default

The report is usually read in the place it lands — an issue, a pull request comment, a run summary —
not in a terminal scrolling past. Markdown is the format those places understand, so it is the default.

Its shape follows from that:

| Choice | Reason |
| --- | --- |
| A real `## Summary` heading | A reviewer can link to a section |
| A table, not padded columns | A comment can be anchored to one policy's row |
| Tables throughout | Padded columns collapse outside a monospace font |
| No code fence around the body | Nothing inside a fence can be commented on, and it wraps badly |
| Finding codes inline as `` `code` `` | The stable string is searchable; the prose is not |

`--format text` remains for a terminal, where alignment is an advantage and Markdown is noise.
`--format json` remains for a consumer, where neither matters.

All three read the same `Report` object, so they cannot disagree about a number.

## 3. What is counted

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

## 4. The report field whitelist

The report is itself a contract, so it has a whitelist too: **the tables below are the complete field
set.** There is nothing outside them. Adding a field means changing `src/report/build.ts`, this page,
and the shape assertion in `tests/report.test.ts` together.

### 4.1 Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `generated_at` | string | Instant of computation. Passed in, never read from the system clock |
| `window` | object \| null | Range the audit log actually covers; `null` for an empty log |
| `summary` | object | Global totals, see 4.2 |
| `lifecycle` | object | Counts for the five lifecycle states, see 4.3 |
| `policies` | array | Per-policy counters, see 4.4 |
| `findings` | array | Derived problem statements, see section 7 |
| `suggestions` | array | Derived concrete changes, see section 8 |

### 4.2 `summary`

| Field | Type | Meaning |
| --- | --- | --- |
| `policies` | number | Policies considered, including those with no history |
| `policies_seen` | number | Policies with at least one audit record |
| `events` | number | Distinct `event_id` values |
| `presented` | number | Lines with `reason: matched` |
| `approved` | number | Lines with `reason: user_approved` |
| `dismissed` | number | Lines with `reason: user_dismissed` |
| `throttled` | number | Lines with `reason: rate_limited` |
| `degraded` | number | Every degraded line in the log, attributed or not |
| `approval_rate` | number \| null | `approved / (approved + dismissed)`; `null` when nobody answered |

### 4.3 `lifecycle`

Exactly five keys, all numbers: `draft`, `validated`, `active`, `muted`, `archived`.
Their sum always equals `summary.policies`.

### 4.4 `policies[]`

| Field | Type | Meaning |
| --- | --- | --- |
| `policy_id` | string | Policy id |
| `state` | string | Lifecycle state |
| `presented` | number | Times this policy surfaced |
| `approved` | number | Times this policy was approved |
| `dismissed` | number | Times this policy was dismissed |
| `muted_short` | number | Times this policy was muted with `mute_1h` |
| `throttled` | number | Times this policy was rate limited |
| `degraded` | number | Degraded lines the log attributes to **this** policy only |
| `rejection_rate` | number \| null | `dismissed / (approved + dismissed)`; `null` when nobody answered |
| `consecutive_dismissals` | number | Current consecutive dismissal streak |
| `muted_until` | string \| null | Expiry of a bounded mute |
| `first_seen` | string \| null | Earliest audit timestamp for this policy; `null` with no records |
| `last_seen` | string \| null | Latest audit timestamp for this policy; `null` with no records |

`summary.degraded` and `policies[].degraded` deliberately use different denominators; the reason is in
section 3, "Degradation and attribution". It is not a typo.

## 5. The read-only projection constraint

The report is a **projection** of the audit log, not a store.

### 5.1 Three hard constraints

1. **It writes nowhere.** `gate report` opens the log read-only, reads it, closes it. No code path lets
   it append a line.
2. **It caches nothing.** No intermediate file, no state database. Deleting the report does not affect
   the next run.
3. **It replays.** The same log, the same `--now` and the same `--timezone` produce byte-identical
   output.

### 5.2 Why this gets its own section

A command that both reads and writes would change its own next output: the second run would count the
first run's lines, and the numbers would drift for no reason the user can see. The report's
trustworthiness comes entirely from being a function; introduce state and that property is gone.

`tests/report-render.test.ts` asserts the audit file is byte-identical before and after a report —
besides this page, that is the only thing preventing the constraint from being broken quietly.

## 6. Lifecycle distribution

`lifecycle` counts the five states from [03-policy-lifecycle](03-policy-lifecycle.md):

```json
{ "draft": 0, "validated": 4, "active": 1, "muted": 0, "archived": 0 }
```

The sum always equals `summary.policies`. `draft` is reachable only through the library API
(`authoringState`), not through the CLI, because the CLI refuses invalid policies before loading them.

## 7. Findings

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

## 8. Suggestions

A **finding** says something is wrong. A **suggestion** says what to change. They are separate because
they carry different evidence, and a reader should be able to act on one without reading the other.

### The evidence boundary — read this before trusting a suggestion

`AUDIT_FIELD_WHITELIST` is: `event_id`, `policy_id`, `decision`, `signal_id`, `user_response`,
`timestamp`, `engine_version`, `degraded`, `reason`.

It contains **no event context and no trigger conditions.** The system therefore does not know that a
dismissal happened during a meeting, in a particular app, or on a project. Any suggestion implying that
would be invented, and a user cannot falsify an invented reason.

What the log does contain is *when*, exactly. That makes one claim defensible:

> **The dismissals cluster in a time range the policy currently covers.**

So a `time_window` narrowing is proposed. Everything else returns no suggestion, because the honest
answer is "the evidence does not support a change" rather than a plausible guess.

### How the window is chosen

| Step | Rule |
| --- | --- |
| Threshold | At least 3 dismissals (configurable) before a suggestion is worth making |
| Bucketing | Dismissals grouped into 2-hour buckets, anchored at hour `00`, in the `--timezone` zone |
| Anchor | Buckets do not shift between runs, so two reports of the same log agree |
| Window | The best contiguous run of buckets, grown only when it strictly increases coverage |
| Concentration | The winning window must hold at least 60% of dismissals, or nothing is proposed |
| Narrowness | On a tie the narrower window wins, because the proposal is to narrow |

Scattered dismissals (say 03:00, 10:00, 15:00, 21:00) produce **no** suggestion. There is no
time-based fix for that pattern, and pretending otherwise would send the user narrowing a window that
changes nothing.

### What a suggestion carries

```json
{
  "policy_id": "morning-focus-protection",
  "kind": "narrow_time_window",
  "summary": "3 of 3 answers were dismissals, 3 of them inside 10:00-12:00",
  "evidence": {
    "dismissals": 3,
    "approvals": 0,
    "buckets": [{ "window": "10:00-12:00", "dismissals": 3 }],
    "concentration": 1
  },
  "proposed_change": { "field": "time_window", "from": "09:00-12:00", "to": "10:00-12:00" },
  "caveats": ["…"]
}
```

`proposed_change` is `null` when the policy declares no `time_window`: there is nothing to narrow, so
the evidence is shown without a fix. A suggestion that always proposes something would be a
suggestion engine that cannot say "no".

`caveats` is **always non-empty**, and always includes the one that matters: *the log records when a
dismissal happened, not why*. The small-sample caveat appears only below 5 dismissals — a caveat that
always appears stops being read.

### Markdown rendering

The proposal is rendered as an applicable diff, because that is the form a user can act on:

````markdown
### `morning-focus-protection`

3 of 3 answers were dismissals, 3 of them inside 10:00-12:00

```yaml
time_window: "10:00-12:00"   # was: 09:00-12:00
```text

Caveats:

- The audit log records when a decision was dismissed, not why. …
````

### What suggestions deliberately do not do

- **They never apply themselves.** A suggestion is text; changing a policy stays a human edit.
- **They never use data outside the whitelist.** If a future field would enable a better suggestion,
  that is an audit-contract decision in [08](08-security-and-audit.md), not a compiler decision here.
- **They never appear as findings.** Acting on a suggestion and clearing a finding are different
  actions with different consequences.
- **They never call an LLM.** Every string is a template: `summary`, the caveats and each `message`
  are fixed phrasing plus numbers, with no model in the path. That is a contract, not an
  implementation detail — a model in the loop would mean the same input could produce different prose,
  and the suggestion would stop being reproducible and auditable.
- **They emit plain text only.** A suggestion carries no applicable patch, writes no file and invokes
  no `gate` subcommand. It tells you what `time_window` should become; making the change stays a human
  action.

## 9. The JSON shape

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
  ],
  "suggestions": [
    {
      "policy_id": "morning-focus-protection",
      "kind": "narrow_time_window",
      "summary": "3 of 3 answers were dismissals, 3 of them inside 10:00-12:00",
      "evidence": {
        "dismissals": 3,
        "approvals": 0,
        "buckets": [{ "window": "10:00-12:00", "dismissals": 3 }],
        "concentration": 1
      },
      "proposed_change": { "field": "time_window", "from": "09:00-12:00", "to": "10:00-12:00" },
      "caveats": ["…"]
    }
  ]
}
```

`window` is `null` for an empty log. `first_seen` / `last_seen` are `null` for a policy with no records.

## 10. Stability promise

| Promise | Meaning |
| --- | --- |
| Snapshot semantics | Two runs over the same log and the same `--now` produce identical output |
| Additive fields only | New keys may appear in a minor version; existing keys keep their meaning |
| Rates are `null`, not `0` | Changing this would be a breaking change |
| Findings are advisory | They never change the exit code |

Not promised: field **order** inside an object, and the wording of `message`. Parse `code`, which is
stable, not the prose, which is meant to be read.

## 11. What this report is not

- **Not a health check.** A report with findings is a normal report.
- **Not a privacy surface.** It reads only the nine-field audit whitelist, so it cannot leak screen
  content — by construction, not by care.
- **Not a substitute for the lifecycle command.** `gate lifecycle` shows per-policy transitions;
  `gate report` shows aggregates. Use both.
- **Not a replacement for `gate audit`.** The audit command prints raw records for a narrow query;
  the report aggregates them. When a number looks wrong, drop to `gate audit` and read the lines.
