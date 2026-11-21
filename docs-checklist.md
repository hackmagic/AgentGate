# Docs PR checklist

Use this checklist to review any documentation pull request, including AI-generated docs. Every item
below is checkable; if one fails, request changes before merge.

`npm run check` covers the mechanical items (frontmatter fields, tree mirroring, link resolution,
heading drift). The rest need a reader.

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

## Markdown

- [ ] Frontmatter present: `title`, `sidebar_position`, `tags`, `description`, `last_updated`
- [ ] Heading levels do not skip (`#` never followed directly by `###`)
- [ ] Exactly one `#` heading per page
- [ ] Every code block has a language tag
- [ ] Tables follow the templates: config `字段名 | 类型 | 默认值 | 是否必填 | 描述`, enum `枚举值 | 含义 | 备注`
- [ ] Ordered lists for steps, unordered for options; nesting no deeper than two levels
- [ ] Admonitions used by meaning: Tip (technique), Note (context), Warning (risk), Caution (data loss / security)

## Links and assets

- [ ] Internal links are relative and resolve inside the current language tree
- [ ] No broken links (`npm run verify-i18n` checks this)
- [ ] External links point to a fixed version where one exists, not a moving home page
- [ ] Images have `alt` text, and carry no text that should be translatable
- [ ] One shared asset set for all languages; no per-language images

## Translation

- [ ] The page exists in `docs/en/` — English is the source
- [ ] `docs/zh-cn/` mirrors it with the same filename
- [ ] Heading outline matches the English page section for section
- [ ] Identifiers are untranslated (`GateSignal`, `require_approval`, `action_id`, …)
- [ ] No Warning or Caution dropped or softened in translation
- [ ] Terminology matches `docs/en/glossary.md`
- [ ] `translation_status` reflects reality (`complete` only after human review)
- [ ] Nothing was added to a translation that the English page does not have

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
