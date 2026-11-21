---
title: "Glossary"
sidebar_position: 99
tags: [reference, glossary]
description: "Canonical definitions for every project-specific term. All pages and all translations use these spellings."
last_updated: 2026-11-22
---

# Glossary

English | [中文](../zh-cn/glossary.md)

Canonical definitions for every project-specific term. **Every page and every translation uses these
spellings.** When two words could mean the same thing here, one of them is wrong.

Terms marked *do not translate* are contract vocabulary: they appear in code, in artifact text, and in
the audit trail, so translating them in prose would break the correspondence.

## Core concepts

| Term | Definition | Translation |
| --- | --- | --- |
| Boundary policy | A YAML file declaring when an agent may act on the user's machine. The unit of authoring. | 边界策略 |
| Policy pack | A directory of related policies plus a `pack.yaml` manifest. | 策略包 |
| Decision | The outcome of evaluating one event: `suggest`, `require_approval`, `suppress` or `allow`. | 决策 |
| Signal | The payload a decision hands to an embodiment layer. Carries intent and presentation, never a command to act. | 信号 |
| Response | A user's answer to a signal: `approve`, `dismiss` or `mute_1h`. | 回执 |
| Event | A normalized observation from an adapter, consumed by the engine. | 事件 |
| Audit record | One content-free line recording a decision and any response. Nine fields, fixed. | 审计记录 |
| Finding | A derived statement that something is wrong. Advisory; never changes an exit code. | 发现项 |
| Suggestion | A derived, falsifiable proposal for a concrete policy change. | 修订建议 |

## Architecture

| Term | Definition | Translation |
| --- | --- | --- |
| Pure core | The layer that decides: parsing, evaluation, signals, mute, lifecycle. No I/O, no system clock. | 纯核心 |
| Composition layer | The layer that orchestrates: the middleware chain, the in-flight inbox, the audit write. | 组合层 |
| Surface | The layer that presents or compiles: pet bridges, MCP, compiler, CLI. | 表面层 |
| Event adapter | The layer that converts external observations into normalized events. Pure translation, no policy logic. | 事件适配层 |
| Middleware chain | The ordered stages an evaluation passes through. Registration order is semantics. | 中间件链 |
| Stage | One replaceable step in the chain (`throttle`, `inbox`, `audit`). | 阶段 |

## Lifecycle

| Term | Definition | Translation |
| --- | --- | --- |
| Lifecycle | The state a policy is in, projected from the audit log. Never a second state file. | 生命周期 |
| Projection | A value computed from the audit log at read time, with no stored state of its own. | 投影 |
| Bounded mute | Silence with an expiry (`mute_1h`). Ends on the clock, without a new audit line. | 有界静音 |
| Unbounded mute | Silence until an explicit unmute, triggered by repeated rejections. | 无界静音 |
| Archive | Operator retirement of a policy. Explicit input, never inferred. | 归档 |

## Compiler

| Term | Definition | Translation |
| --- | --- | --- |
| Compile target | One output shape: `agents`, `skill`, or `mcp`. | 编译目标 |
| Source hash | `sha256` of the ordered policy set. Identical across targets for one input. | 源哈希 |
| Format version | The rendering contract version, decoupled from the engine version. | 格式版本 |
| Parity | The claim that the targets describe one policy set, checked two ways: identity and fidelity. | 一致性 |
| Fidelity | Facts read back from the emitted artifact matching the source policy. | 保真 |

## Terms that do not translate

These are identifiers. They stay in their original form in every language, inside and outside code
blocks. `GateSignal`, `require_approval`, `action_id`, `AGENTS.md`, `SKILL.md`, `mcp.json`,
`AuditRecord`, `AgentGate`, `OpenPets`, `ActivityWatch`.

## Writing conventions

| Convention | Rule |
| --- | --- |
| "The engine" | Always the AgentGate engine. Never "the system" when the engine is meant. |
| "The user" | The person whose boundaries the policies encode. Not "the operator" — that is the person archiving. |
| "Must" / "never" | Reserved for contract statements that a test enforces. Elsewhere, prefer "should". |
| Sentence case | For all headings except proper nouns. |

## Adding a term

1. Add it to this page first, in the right section, with its Chinese rendering.
2. Then use it in the pages that need it.
3. Then translate it into every other language's glossary.

Adding a term to a translation first is not allowed: the English glossary is the source.
