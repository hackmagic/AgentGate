---
title: "Documentation index"
sidebar_position: 0
tags: [index]
description: "Entry point for the AgentGate documentation: what each page answers and who it is for."
last_updated: 2026-11-22
translation_status: complete
---

# Documentation index

[中文](/) | English

Three documents each answer one question; the rest are contract appendices.

| Document | Answers | Read it when |
| --- | --- | --- |
| [00 · Project brief](00-project-brief.md) | What this is, and what it is not | Learning about the project for the first time |
| [01 · Product requirements](01-prd.md) | Who it serves and what for | Deciding whether a request is in scope |
| [**02 · Runtime architecture**](02-architecture.md) | **How the system runs** | Before changing code; layer constraints and the middleware chain |
| [**03 · Policy lifecycle**](03-policy-lifecycle.md) | **One policy from birth to retirement** | Contributing a policy, or debugging "why did it stop appearing" |
| [04 · Policy DSL](04-policy-dsl.md) | How to write a policy; the five semantic rules | Writing a policy, or changing the evaluator |
| [05 · Event specification](05-event-spec.md) | What the engine's input looks like | Writing an adapter |
| [**06 · Compiler specification**](06-compiler-spec.md) | **How one policy stays consistent everywhere** | Changing the compiler, or judging whether an artifact is stale |
| [07 · Embodiment interface](07-pet-bridge.md) | How a signal reaches the user | Building a pet or a HUD |
| [08 · Security and audit](08-security-and-audit.md) | Permission levels and the audit boundary | Anything touching privacy or execution |
| [09 · Roadmap and acceptance](09-mvp-roadmap.md) | What is done and what comes next | Looking for a place to contribute |
| [10 · Report specification](10-report-spec.md) | What `gate report` computes and what a consumer may rely on | Building on the report output |
| [Glossary](glossary.md) | Canonical spelling and meaning of every project term | Writing any page, or translating one |
| [Contributing translations](contributing/translations.md) | Translation workflow, boundaries, and review criteria | Changing a translated page |
| [Docs PR review checklist](contributing/review-checklist.md) | The verdict checklist for a documentation PR | Opening or reviewing a docs PR |

## Why three documents are bold

An earlier version used one `02-architecture.md` to cover runtime, lifecycle and the compiler. The
result diluted all three: a reader looking for "what happens after a policy is rejected" or for "why
should I trust the compiled artifacts" found neither.

The split follows **different readers**:

- Someone changing the engine reads 02 and needs inter-layer contracts and dependency direction.
- Someone writing a policy reads 03 + 04 and needs the state machine and the semantic rules.
- Someone integrating reads 06 and needs artifact shapes and version promises.

## Documentation is a contract

The files under `docs/` are not descriptive; they are executable:

| Document | Pinned by |
| --- | --- |
| 02 layer constraints | `npm run lint` (`scripts/check-boundaries.mjs`) |
| 03 lifecycle rules | `tests/lifecycle.test.ts` |
| 04 the five semantic rules | `tests/gate.test.ts`, `tests/policy.test.ts` |
| 05 event specification | `schemas/event.schema.json` + `npm run validate-specs` |
| 06 consistency contract | `tests/parity.test.ts` + `gate verify` |
| 08 audit whitelist | `tests/contract.test.ts` + a CI assertion |
| Every document | `npm run validate-specs` checks the facts docs claim |

**Do not edit a spec under `docs/` just to make code pass.** The spec is the contract and the code is
the implementation. When they disagree, first work out which one is wrong — not which one is easier to
change.

## Translations

**Chinese is the single source of truth**; English is a localization of it. The two trees are mirrored
directories:

```text
docs/
├── zh-cn/       source of truth, authored first
├── en/          translation, mirrors zh-cn/ page for page
└── i18n/        pairing record (generated, do not edit)
```

Each page links to its counterpart in the other tree directly under the H1. Three gates keep the trees
from drifting apart:

- `npm run verify-i18n` — both pages exist, each links to the other, the heading outlines match, and
  the section hashes in `docs/i18n/pairs.json` still agree, so editing one side without the other
  fails CI;
- `npm run lint-docs` — complete frontmatter, one H1, no skipped heading level, every code fence
  tagged, no CRLF or BOM, and `translation_status` only on translated pages;
- `npm run docs:build` — the docs site must build, which is where an unescaped placeholder or a link
  escaping the site root surfaces.

After a deliberate edit, re-record with `npm run verify-i18n -- --write`.

Code blocks and identifiers stay as written in every language: `GateSignal`, `require_approval` and
`AGENTS.md` are proper nouns of the system, and translating them would break the contract they name.

## Documentation site

The site is built with VitePress. **Chinese is mounted at the root**, English under `/en/`:

```bash
npm run docs:dev      # local preview with hot reload
npm run docs:build    # emits docs/.vitepress/dist
npm run docs:preview  # preview the built output
```

Sidebar, language switcher, previous/next, search and other framework strings are configured in
`locales` in `docs/.vitepress/config.mjs`. Do not write them into page bodies — there they become
noise every translator has to handle.
