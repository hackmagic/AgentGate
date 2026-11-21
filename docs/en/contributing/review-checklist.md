---
title: "Docs PR review checklist"
sidebar_position: 22
tags: [contributing, review]
description: "Checklist for reviewing any documentation PR, including AI-generated content. Mechanical items are covered by gates; the rest need a reader."
last_updated: 2026-11-22
translation_status: complete
---

# Docs PR review checklist

[中文](/contributing/review-checklist) | English

Use this page to review any documentation pull request, **including AI-generated content**. Every item
below is checkable; if one fails, request changes before merge.

`npm run check` covers the mechanical items: frontmatter, tree mirroring, link resolution, heading drift,
code-fence language tags, and site buildability. The rest need a reader.

## Run the gates first

```bash
npm run check        # types, architecture, i18n, docs lint, tests, specs, build, integrations
npm run docs:build   # the docs site must build
```

If either fails there is no point reading further — the mechanical items already stopped it.

## Classification

- [ ] The page has exactly one type: Tutorial / Guide / Reference / Contributing / Troubleshooting / Migration
- [ ] A Tutorial contains only what is needed to run the first demo — no parameter enumerations, no full API tables
- [ ] A Reference is dictionary-style — no long tutorial paragraphs, links out to a Guide instead
- [ ] A Guide links to the Reference rather than restating its parameters
- [ ] Migration entries are ordered newest to oldest, each with impact, steps and a rollback

## Facts

- [ ] Every parameter, default, return field, error code and command matches the source or actual behaviour
- [ ] Nothing is invented; anything unverified is marked `Experimental` or "to be confirmed"
- [ ] No subjective marketing language ("powerful", "fastest", "recommended") unless it is a stated fact
- [ ] Deprecated content says `Deprecated since vX.Y.Z`, names the removal version and the replacement
- [ ] Experimental content says that compatibility is not guaranteed and it is unsuitable for production

## Markdown and the site

- [ ] No heading level is skipped, and the page has exactly one `#`
- [ ] Every code fence has a language tag
- [ ] Placeholders are written as `&lt;name&gt;`, or the site cannot compile the page
- [ ] In-site links are site-absolute (such as `/02-architecture`); links to repository-root files use an absolute GitHub URL
- [ ] Images carry alt text, and no meaning is drawn into the image

## Translation

The full rules are in [Contributing translations](translations.md). For review, confirm:

- [ ] **Chinese is the source**: content changes land in `docs/zh-cn/` first
- [ ] Both trees share filenames, and the heading outlines match section for section
- [ ] Identifiers are untranslated (`GateSignal`, `require_approval`, `action_id`, …)
- [ ] No Warning or Caution dropped or softened
- [ ] Terminology matches [the glossary](../glossary.md)
- [ ] `translation_status` reflects reality (`complete` only after human review)

## Ship

- [ ] PR title starts with `docs:`
- [ ] Code changes that altered behaviour are accompanied by their documentation change in the same PR
- [ ] `CHANGELOG.md` updated when the change is user-visible
- [ ] No hardcoded private IP, local absolute path or internal URL
- [ ] No advertising, unrelated recommendation or non-official third-party link

## AI-generated docs, additionally

- [ ] Every claim traceable to a file, a test or a command that was actually run
- [ ] Any limitation stated as a limitation, not quietly omitted
- [ ] A self-check result accompanies the output, listing what was verified and what remains unverified

## How this page relates to the others

This page is an **index and a verdict**, not a second copy of the rules. The rules live in their own pages:

| What you want to know | Where |
| --- | --- |
| How to translate, the boundaries, review criteria | [Contributing translations](translations.md) |
| The canonical spelling of a term | [Glossary](../glossary.md) |
| What each page covers and why it is separate | [Documentation index](/en/index) |
