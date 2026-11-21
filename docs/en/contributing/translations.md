---
title: "Contributing translations"
sidebar_position: 21
tags: [contributing, i18n]
description: "How to translate AgentGate documentation: the workflow, the boundaries, and what reviewers check."
last_updated: 2026-11-22
---

# Contributing translations

English | [中文](../../zh-cn/contributing/translations.md)

English is the single source of truth. Every other language is a localization of it. This page covers
the workflow, the boundaries, and what a reviewer checks.

## Layout

```text
docs/
├── en/          source of truth
├── zh-cn/       translation, mirrors en/ page for page
└── i18n/        pairing record (generated, do not edit)
```

Both trees use **identical filenames**. A page that exists in `docs/en/` must exist in `docs/zh-cn/`
with the same name. `npm run verify-i18n` fails when a page is missing, when a heading outline
diverges, or when one side changed and the other did not.

Repository-root pages (`README.md`, `CONTRIBUTING.md`) keep the sibling form, because tools and hosts
read them from the root.

## The two rules that matter

### 1. Translate prose, never identifiers

| Translate | Do not translate |
| --- | --- |
| Body text, headings, descriptions | Code, variable names, config keys, commands |
| Admonition text, troubleshooting prose | Parameter names, error codes, log keywords |
| Contributing guidance | Enum values, endpoint paths, package names, versions |

Comments inside a code block may be translated. The code itself may not change.

### 2. A translation may not change meaning

A translation:

- may localize expression — split a long English sentence, use the phrasing a native developer expects;
- may **not** add a tutorial the English page does not have;
- may **not** drop or soften a Warning or Caution;
- may **not** rewrite the described behaviour;
- may **not** expand or compress the information — the meaning must be equivalent.

If the English page is wrong, fix the English page. Do not fix it only in a translation: the
translation would then be the only correct copy, and the next sync would erase the fix.

## Workflow

1. **Change the English page first.** Every content change starts there.
2. **Run the gate.** `npm run verify-i18n` reports what is out of sync.
3. **Translate.** Update `docs/zh-cn/` with the same structure.
4. **Re-record.** `npm run verify-i18n -- --write` updates the pairing hashes.
5. **One pull request.** English change and translation together, titled `docs:`.

Translations of a page that does not exist in English are rejected, not merged and fixed later. The
two trees must stay comparable at every commit.

## Translation status

Each translated page declares how complete it is:

| `translation_status` | Meaning | What a reader sees |
| --- | --- | --- |
| `complete` | Fully translated, reviewed | The translation |
| `partial` | Some sections still English | A mix, with the untranslated parts in English |
| `todo` | Not started | The English page, or nothing |

A page with `partial` must leave the untranslated sections in English rather than machine-translating
them. A rough translation of a Warning is worse than an untranslated one.

## What reviewers check

A translation pull request is reviewed against the English original, not against the translator's
intent.

- [ ] The page exists in English, with the same filename
- [ ] Heading outline matches section for section
- [ ] No identifier translated (`GateSignal`, `require_approval`, `action_id`, …)
- [ ] No Warning or Caution dropped or softened
- [ ] No content added that the English page does not have
- [ ] Terminology matches [the glossary](../glossary.md), not a synonym
- [ ] `translation_status` reflects reality
- [ ] `npm run verify-i18n` passes
- [ ] Links resolve inside the translated tree
- [ ] Code blocks are byte-identical to the English page except for comments

## When not to submit a translation

- **The English page is in flux.** A translation of a page being rewritten will be stale on merge.
  Wait for the English change to land.
- **You would have to guess.** If a term is not in the glossary and the English is ambiguous, ask on
  the English page first. A guessed translation of a contract term is a defect that survives review.
- **The change is a fact, not a phrasing.** Numbers, defaults, error codes and version ranges belong to
  the English source; do not "correct" them in a translation.

## Machine translation

Machine translation is allowed as a first draft and never as a final one. Mark such a page
`translation_status: partial` until a human has read it, and never let it carry `complete`.

The specific risk: a machine translator will translate identifiers inside prose, reorder a Warning into
a subordinate clause, and translate `must` as a suggestion. All three are contract damage.

## Labels

| Label | Use |
| --- | --- |
| `docs` | Documentation-only change |
| `i18n` | Translation, or a change to the translation tooling |
| `i18n:zh-cn` | The specific language touched |

## Adding a language

1. Add the glossary first: `docs/<lang>/glossary.md`, translated from
   [the English glossary](../glossary.md).
2. Add the tree `docs/<lang>/` and mirror the page list.
3. Extend `scripts/verify-i18n.mjs` to know the new tree — the script currently pairs `en` with
   `zh-cn` explicitly, and adding a language means adding it there.
4. Add framework locale strings (sidebar, search, version selector) through the docs site's i18n
   configuration, never hardcoded in page bodies.
