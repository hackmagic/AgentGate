# 06 · Compiler specification

English | [中文](06-compiler-spec.zh.md)

> This document answers one question: **what makes one policy runnable everywhere**.
> Runtime architecture is in [02-architecture](02-architecture.md); lifecycle is in
> [03-policy-lifecycle](03-policy-lifecycle.md).

One policy source compiles into three target shapes: an `AGENTS.md` section, `SKILL.md` skills, and an
MCP bundle. Following transskill's adapter pattern — **source format → target adapter → output** —
rather than hand-writing each form.

"One policy, runs everywhere" is unverifiable marketing unless it is checkable. This chapter defines
four contracts that can be checked: **input, output, version, consistency**.

## 1. Compiler input

```ts
compilePolicies(policies: readonly Policy[], target: CompileTarget): CompilationBundle
```

- `policies` are `Policy` objects that already passed `validatePolicyDocument()`. The compiler does no
  semantic validation; it assumes valid input and treats invalid input as a caller bug rather than
  compensating during rendering.
- Ordering is fixed to ascending `id`, so two compilations produce byte-identical output.
- The compiler is a **pure function**: no file access, no clock, no generated randomness. Writing to
  disk is `writeBundle()`'s job.

## 2. Compiler output

Every bundle carries four metadata fields:

| Field | Meaning |
| --- | --- |
| `target` | `agents` / `skill` / `mcp` |
| `engine_version` | The engine that produced it (`0.2.0`) |
| `format_version` | The **rendering contract** version (currently `1`), decoupled from the engine version |
| `source_hash` | `sha256(stableStringify(sorted(policies)))` |

Each file in `files[]` carries its own `sha256` covering the exact bytes. That answers "which artifact
is stale" per file instead of forcing a whole-bundle rebuild.

### What format_version is for

The engine version answers "who generated this"; the format version answers "how should a reader parse
it". They must stay separate. Fixing an internal bug moves the engine version while the artifact shape
is unchanged, so an agent that already read it needs no re-read. Conversely, renaming a section heading
may leave the engine version alone while every agent needs to re-read.

**Rule: bump `format_version` whenever a target's rendered shape changes in a way an already-shipped
agent would read differently.** It is defined in `src/version.ts` and `tests/parity.test.ts` asserts it
appears in the emitted artifacts.

## 3. Target format matrix

| Policy field | → `AGENTS.md` | → `SKILL.md` | → MCP bundle |
| --- | --- | --- | --- |
| `description` | Chapter title | Frontmatter `description` | Bundle README summary |
| `trigger` + `conditions` | "When it applies" paragraph | Condition description in Instructions | `gate/evaluate` `inputSchema` constraints |
| `decision` + `action` | "Behaviour rules" paragraph | Action description in Instructions | The `decision` field of the response |
| `safety` | "Prohibitions" paragraph | Boundaries in Instructions | `requires_approval` metadata |
| `presentation` | "Presentation" paragraph | Presentation constraints | `signal.presentation` |
| `priority` | Header metadata line | — | Internal evaluation order |

### The three artifact shapes

**AGENTS.md** — one chapter per policy, so a policy change diffs cleanly against the agent contract:

```
# 个人引导策略（由 AgentGate 编译，请勿手改）
本文件由 agent-gate v0.3.0 以编译格式 v1 从 5 条策略生成。…
## 通用求值规则       ← the five semantic rules
## 边界               ← the executor is not the policy author
## {description}      ← one chapter per policy
   > 策略 `<id>` v1 · 优先级 80 · 源哈希 `abcdef123456`
   ### 何时适用 / ### 行为规则 / ### 禁止事项 / ### 呈现
```

**SKILL.md** — one skill per policy, at `skills/agent-gate-<policy-id>/SKILL.md`:

```yaml
---
name: agent-gate-morning-focus-protection
description: 工作日早上进入专注块时…（个人引导策略 morning-focus-protection：必须先取得用户批准）
---
```

The Instructions body defines four steps: call `gate/evaluate` → act on `decision` → present the copy
verbatim → send back `signal_id` / `action_id`.

**MCP bundle**:

```
mcp.json                          # merge straight into an MCP client config
agent-gate-policies/<id>.yaml     # policy copies, reloadable by the CLI
README.md                         # tool table plus the contract summary
```

```json
{
  "mcpServers": {
    "agent-gate": {
      "command": "npx",
      "args": ["-y", "agent-gate", "mcp", "--policy", "./agent-gate-policies"],
      "env": { "AGENT_GATE_ENGINE_VERSION": "0.3.0" }
    }
  }
}
```

## 4. The consistency contract (the important part)

Consistency has two halves. Skipping either produces a comfortable false confidence.

### 4.1 Identity: the three targets describe one policy set

`source_hash` must be identical across the three targets. That catches a compiler rendering different
inputs per target.

### 4.2 Fidelity: facts read back from the artifact match the source policy

The hash alone is not enough: a renderer that drops a field keeps the hash unchanged, because the hash
covers the input. So `verifyCompilation()` reads the artifacts **back as text**, recovers four facts,
and compares them against the source policy one by one:

| Fact | Where it is read from |
| --- | --- |
| `policy_id` | `> 策略 \`<id>\`` / `策略 \`<id>\`` |
| `decision` | `- 决策：\`<decision>\`` / the instruction list item |
| `requires_approval` | The first sentence of the safety section |
| `bubble_text` | "气泡文案（固定…）：…" |

It reads from the **emitted bytes** rather than comparing in-memory objects. That is deliberate: an
in-memory comparison would pass even when the renderer loses a field.

```bash
gate verify --policy packs/deep-work          # all three targets
gate compile --policy packs/deep-work --out out --target all   # compile verifies and aborts on failure
```

### 4.3 Consistency error codes

| code | Trigger |
| --- | --- |
| `source_hash_mismatch` | Targets disagree on `source_hash` |
| `format_version_mismatch` | Targets were rendered by different format versions |
| `missing_policy` | A source policy disappeared from some target |
| `unknown_policy` | A target mentions an id outside the source policy set |
| `decision_drift` | The artifact's decision differs from the source policy |
| `approval_drift` | The artifact's approval stance differs from the source policy |
| `copy_drift` | The artifact's copy differs from the source policy |
| `invalid_policy_copy` | An MCP policy copy fails the validator round-trip |
| `unparsable_policy_copy` | A policy copy is not valid JSON |
| `missing_artifact` / `unparsable_skill` | A target lacks a key artifact, or it cannot be parsed |
| `unknown_target` | A target appeared with no fact reader (compiler grew a target, verifier did not) |

### 4.4 Acceptance criteria

> Given the same `morning-focus-protection` policy, the compile command produces a valid `AGENTS.md`
> section, a `SKILL.md` file and a startable MCP server; all three agree when evaluating the same
> simulated event.

Where that lives in the repository:

| Assertion | Test |
| --- | --- |
| All three `source_hash` values match and are stable | `tests/parity.test.ts` |
| Every target yields every policy | `tests/parity.test.ts` |
| A dropped field is caught | `tests/parity.test.ts` (the `approval_drift` case) |
| A missing policy is caught | `tests/parity.test.ts` (the `missing_policy` case) |
| MCP policy copies round-trip | `tests/parity.test.ts` + `tests/compile.test.ts` |
| AGENTS.md and SKILL.md yield identical facts | `tests/parity.test.ts` |

## 5. Artifact manifest

```bash
gate compile --policy packs/deep-work --out out --target all
```

Writes `out/compile-manifest.json`:

```json
{
  "engine_version": "0.3.0",
  "format_version": "1",
  "source_hash": "…",
  "targets": ["agents", "skill", "mcp"],
  "policies": ["evening-quiet-hours", "…"],
  "files": ["AGENTS.md", "mcp.json", "skills/agent-gate-…/SKILL.md"],
  "artifacts": [
    { "target": "agents", "source_hash": "…", "files": [{ "path": "AGENTS.md", "sha256": "…" }] }
  ]
}
```

`artifacts` lets a consumer tell **which specific artifact** is stale, instead of only knowing the whole
bundle changed.

## 6. Version compatibility promises

| Promise | Meaning |
| --- | --- |
| `format_version` only grows, never remeans | Within one `format_version`, section titles and field positions are stable |
| Unknown fields are ignored, not rejected | A new policy field does not break older artifacts |
| The `source_hash` algorithm is fixed | Hashes stay comparable across versions |
| Artifacts are always self-describing | The header states engine version and format version; no side lookup needed |

Not promised: **byte-identical artifact text across major versions**. Rendering is written for humans
and headings improve as the documentation does. Compatibility is carried by `format_version`, not by
bytes.
