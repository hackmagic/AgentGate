---
title: "01 · Product requirements"
sidebar_position: 2
tags: [product]
description: "English | 中文(01-prd.md)"
last_updated: 2026-11-22
translation_status: complete
---

# 01 · Product requirements

[中文](/01-prd) | English

## Target user

Developers and knowledge workers who already use coding agents but lack a boundary for when those
agents may act on their machine.

Their real pain is not "the AI is not smart enough", it is:

- not knowing under what conditions an agent will change things by itself;
- having to restate the boundary every time they switch tools (Cursor → Claude Code → Codex);
- and, once over-interrupted, turning every reminder off and going back to manual work.

## Core user stories (the MVP keeps three)

| ID | Story | Acceptance |
| --- | --- | --- |
| US-1 | As a user, I want to import my ActivityWatch data so the system can identify my deep-work blocks | Reads window/app events, emits focus-block events |
| US-2 | As a user, I want a "deep work protection" policy that suppresses notifications while I focus, but only with my approval | The policy can be saved, compiled, and triggers an approval through the pet |
| US-3 | As a user, I want to reuse the same policy in Cursor and Claude Code without rewriting it | One policy source compiles to `SKILL.md` and `AGENTS.md` (and MCP tools) |

## Non-goals

Emotional companionship, pet raising, social features, enterprise compliance — those belong to the
ecosystem layer, not the kernel.

## Functional scope

### In

- Event semantics (`focus_block_started` / `app_switch` / `idle_detected` and so on)
- Policy DSL: YAML, readable, validatable
- Deterministic evaluation engine: priority, condition tree, mute and rate limiting
- Cross-agent compilation: `AGENTS.md` / `SKILL.md` / MCP bundle
- Content-free audit
- Embodiment presentation contract (the pet only consumes signals)

### Out (this cycle)

- System-level action execution (implementing notification suppression or DND is left to adapters)
- A visual policy editor
- Multi-user / cloud sync
- Any form of screen content analysis

## Key quality attributes

| Attribute | Target | How it is guaranteed |
| --- | --- | --- |
| Predictable | Same event + same policy set → same decision | Pure evaluation + fixed-clock tests |
| Non-intrusive | No automatic retry after a rejection | `mute` state machine + rate limiting + tests |
| Auditable | Every guidance event traces back to its trigger | Nine-field audit + enforced whitelist |
| Non-overreaching | Nothing executes unapproved | `resolveDecision` downgrade + semantic validation |
| Portable | One policy source reused across agents | Three-target compilation + `source_hash` and fact parity tests |
