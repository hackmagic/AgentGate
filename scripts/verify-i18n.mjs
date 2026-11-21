#!/usr/bin/env node
/**
 * Bilingual pairing gate, modelled on DSH's `verify-translation-pairing`.
 *
 * Every document is a pair: `<name>.md` (English) and `<name>.zh.md` (Chinese).
 * This script proves three things and refuses to guess about a fourth:
 *
 *   1. Both sides of every pair exist.
 *   2. Each side links to the other, so neither is a dead end.
 *   3. The heading outlines match, so a translation cannot quietly drop a
 *      section — the most common way a bilingual doc set rots.
 *   4. Per-section hashes of both sides are recorded in docs/i18n/pairs.json.
 *      Editing one side without the other changes its hash, so CI catches a
 *      half-finished translation without anybody remembering to look.
 *
 * Hash scope, following DSH: heading sections, excluding fenced code blocks and
 * excluding the language switcher line. Prose that must stay identical (code,
 * identifiers, policy YAML) therefore never registers as translation drift.
 *
 *   npm run verify-i18n            # check
 *   npm run verify-i18n -- --write # re-record after a deliberate edit
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RECORD = path.join(ROOT, 'docs', 'i18n', 'pairs.json');
const WRITE = process.argv.includes('--write');

/**
 * Layout: **Chinese is the source of truth.** `docs/zh-cn/` is authored first
 * and `docs/en/` mirrors it page for page with identical filenames. A directory
 * per language is still the right shape — translation platforms and docs sites
 * both expect it — but the direction of authorship is Chinese-first.
 *
 * Repository-root pages keep the sibling form because tools and hosts read them
 * from the root rather than from `docs/`. The source language is still Chinese,
 * so the base name (`README.md`) is Chinese and the English copy carries the
 * language suffix (`README.en.md`) — the same direction as everywhere else.
 */
const ROOTS = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md'];
const SOURCE_DIR = path.join(ROOT, 'docs', 'zh-cn');
const TRANSLATION_DIR = path.join(ROOT, 'docs', 'en');
/** Kept as aliases so the existing logic reads naturally. */
const EN_DIR = TRANSLATION_DIR;
const ZH_DIR = SOURCE_DIR;

/** Docs that are English-only by design, with the reason recorded here. */
const SINGLE_LANGUAGE = new Set([
  // Contributor-facing agent instructions: the machine reads one file, and a
  // translated copy would be a second source of truth for agent behaviour.
  'AGENTS.md',
]);

const SWITCHER = /^\[English\]\([^)]*\) \| 中文$|^English \| \[中文\]\([^)]*\)$/;

/** List `.md` files under `dir`, recursively, with paths relative to `dir`. */
function listMarkdown(dir, base = dir, out = []) {
  if (!existsSync(dir)) return [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listMarkdown(absolute, base, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(path.relative(base, absolute).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

const rootDocs = ROOTS.map((name) => path.join(ROOT, name)).filter((p) => existsSync(p));
/** The authored tree first, then its translation. */
const sourceDocs = listMarkdown(SOURCE_DIR).map((name) => path.join(SOURCE_DIR, name));
const translationDocs = listMarkdown(TRANSLATION_DIR).map((name) => path.join(TRANSLATION_DIR, name));

const rel = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');

/**
 * The counterpart of a primary document.
 *
 * Root pages pair as siblings; `docs/en/x.md` pairs with `docs/zh-cn/x.md`.
 * A missing counterpart is reported by the caller, not guessed here.
 */
const counterpartOf = (absolute) => {
  const resolved = path.resolve(absolute);
  if (resolved.startsWith(path.resolve(SOURCE_DIR) + path.sep)) {
    // Mirror the *relative* path, so `contributing/x.md` maps into the other
    // tree at the same subdirectory rather than collapsing to the root.
    return path.join(TRANSLATION_DIR, path.relative(SOURCE_DIR, resolved));
  }
  return absolute.replace(/\.md$/, '.en.md');
};

/** Source documents: the Chinese tree plus the English root pages. */
const primaryDocs = [...rootDocs, ...sourceDocs];

/** Split a document into heading sections, skipping fenced code blocks. */
function sections(text) {
  const lines = text.split('\n');
  const result = [];
  let current = { heading: '', level: 0, body: [] };
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      // Fence markers are structural, not prose; drop them from the hash body
      // but keep the code inside so a changed example still registers.
      current.body.push(line);
      continue;
    }
    if (!inFence) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading !== null) {
        result.push(current);
        current = { heading: heading[2].trim(), level: heading[1].length, body: [] };
        continue;
      }
    }
    current.body.push(line);
  }
  result.push(current);
  return result.filter((section) => section.heading !== '' || section.body.some((line) => line.trim() !== ''));
}

/**
 * Hash the prose of one section.
 *
 * Heading *text* is excluded: a translation translates the heading, so hashing
 * it would report every section as drifted. What identifies a section across
 * languages is its position and its depth, and that is what the key carries.
 */
function hashSection(section) {
  const body = section.body
    .filter((line) => !SWITCHER.test(line.trim()))
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

const sectionKey = (index, section) => `${index}:h${section.level}`;

const problems = [];
const record = {};

for (const primary of primaryDocs) {
  const primaryRel = rel(primary);
  if (SINGLE_LANGUAGE.has(primaryRel)) continue;

  const zh = counterpartOf(primary);
  if (!existsSync(zh) || !statSync(zh).isFile()) {
    problems.push(`${primaryRel}: missing the translated counterpart ${rel(zh)}`);
    continue;
  }

  const enText = readFileSync(primary, 'utf8');
  const zhText = readFileSync(zh, 'utf8');

  // 2. Each side must link to the other.
  //
  // Three kinds of page exist, and each links back differently:
  //
  //   docs source page   `docs/zh-cn/x.md`  -> `/en/x`   (served at the root)
  //   docs translated    `docs/en/x.md`     -> `/x`
  //   repository root    `README.md`        -> `README.en.md` (sibling file)
  //
  // The docs index is special: `rewrites` serves `README.md` as the directory
  // root, so its counterpart is the other locale's root rather than `/index`.
  const enBase = path.basename(primary);
  const zhBase = path.basename(zh);

  const resolvedPrimary = path.resolve(primary);
  const inSourceDocs = resolvedPrimary.startsWith(path.resolve(SOURCE_DIR) + path.sep);
  const inTranslationDocs = resolvedPrimary.startsWith(path.resolve(TRANSLATION_DIR) + path.sep);

  /** This page's path inside its own language tree, e.g. `contributing/x.md`. */
  const pageRelative = inSourceDocs
    ? path.relative(SOURCE_DIR, resolvedPrimary).split(path.sep).join('/')
    : inTranslationDocs
      ? path.relative(TRANSLATION_DIR, resolvedPrimary).split(path.sep).join('/')
      : null;

  if (pageRelative !== null) {
    const slug = pageRelative.replace(/\.md$/, '');
    const isIndexPage = slug === 'README' || slug.endsWith('/README');

    // Direction, stated once so it cannot be inverted again:
    //
    //   the source page (Chinese) links to the TRANSLATION
    //   the translation page (English) links back to the SOURCE
    //
    // For a normal page those are `/en/x` and `/x`. For the index they are the
    // two locale roots, `/en/` and `/`.
    const absoluteOnSource = isIndexPage ? '(/en/)' : `(/en/${slug})`;
    const absoluteOnTranslation = isIndexPage ? '(/)' : `(/${slug})`;

    const depth = pageRelative.split('/').length - 1;
    const up = depth === 0 ? '..' : Array.from({ length: depth + 1 }, () => '..').join('/');
    const relativeOnSource = `(${up}/en/${pageRelative})`;
    const relativeOnTranslation = `(${up}/zh-cn/${pageRelative})`;

    // `enText` reads `primary` (the source page); `zhText` reads its counterpart
    // (the translation). The names are historical; the mapping is:
    //   source page      -> must link to the translation
    //   translation page -> must link back to the source
    const expectedOnSourceText = absoluteOnSource;
    const expectedOnTranslationText = absoluteOnTranslation;

    if (!enText.includes(expectedOnSourceText) && !enText.includes(relativeOnSource)) {
      problems.push(`${primaryRel}: does not link to ${expectedOnSourceText.slice(1, -1)}`);
    }
    if (!zhText.includes(expectedOnTranslationText) && !zhText.includes(relativeOnTranslation)) {
      problems.push(`${rel(zh)}: does not link to ${expectedOnTranslationText.slice(1, -1)}`);
    }
  } else {
    // Repository-root pages pair as siblings: `README.md` <-> `README.en.md`.
    if (!enText.includes(`(${zhBase})`)) problems.push(`${primaryRel}: does not link to ${zhBase}`);
    if (!zhText.includes(`(${enBase})`)) problems.push(`${rel(zh)}: does not link to ${enBase}`);
  }

  // 2b. Every relative link must resolve. A translation carries its own set of
  // link targets (`foo.zh.md`), and those rot independently of the English
  // side — a broken cross-reference is the cheapest possible docs bug to ship.
  for (const [file, text] of [
    [primaryRel, enText],
    [rel(zh), zhText],
  ]) {
    for (const match of text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:)/.test(target)) continue;

      // Site-absolute links are correct under the docs site's `rewrites`: the
      // file path and the served path intentionally differ, so `/02-architecture`
      // is a real page while `02-architecture.md` is only its source. Resolving
      // them against the filesystem would report a working site as broken.
      if (target.startsWith('/')) continue;

      if (!existsSync(path.resolve(path.dirname(file), target))) {
        problems.push(`${file}: link target does not exist: ${target}`);
      }
    }
  }

  // 3. Heading outlines must match one-for-one.
  //
  // Compare structure, not text: a translation's headings are translated, so
  // requiring equal strings would flag every section. What must not change is
  // how many sections exist and at what depth — that is what catches a
  // translation quietly dropping a section.
  const enSections = sections(enText);
  const zhSections = sections(zhText);
  if (enSections.length !== zhSections.length) {
    problems.push(
      `${primaryRel}: ${enSections.length} sections in the source vs ${zhSections.length} in the translation — ` +
        `a section was added or dropped on one side`,
    );
  } else {
    for (let index = 0; index < enSections.length; index += 1) {
      const en = enSections[index];
      const other = zhSections[index];
      if (en.level !== other.level) {
        problems.push(
          `${primaryRel}: section ${index + 1} is H${en.level} in the source ("${en.heading}") but ` +
            `H${other.level} in the translation ("${other.heading}")`,
        );
      }
    }
  }

  // 4. Record per-section hashes for both sides.
  const key = primaryRel;
  record[key] = {};
  for (const [index, section] of enSections.entries()) {
    record[key][sectionKey(index, section)] = {
      en: hashSection(section),
      zh: zhSections[index] === undefined ? null : hashSection(zhSections[index]),
    };
  }
}

// Compare against the recorded hashes, if a record exists.
if (!WRITE && existsSync(RECORD)) {
  const previous = JSON.parse(readFileSync(RECORD, 'utf8'));
  for (const [doc, sectionsBefore] of Object.entries(previous.pairs ?? {})) {
    const now = record[doc];
    if (now === undefined) {
      problems.push(`${doc}: recorded pair vanished (document renamed or deleted)`);
      continue;
    }
    for (const [sectionKey, before] of Object.entries(sectionsBefore)) {
      const after = now[sectionKey];
      if (after === undefined) {
        problems.push(`${doc} §${sectionKey}: section disappeared since it was recorded`);
        continue;
      }
      if (before.en !== after.en && before.zh === after.zh) {
        problems.push(
          `${doc} §${sectionKey}: English changed but Chinese did not — translate it, then run ` +
            `\`npm run verify-i18n -- --write\``,
        );
      }
      if (before.zh !== after.zh && before.en === after.en) {
        problems.push(
          `${doc} §${sectionKey}: Chinese changed but English did not — update both, then run ` +
            `\`npm run verify-i18n -- --write\``,
        );
      }
    }
    for (const sectionKey of Object.keys(now)) {
      if (!(sectionKey in sectionsBefore)) {
        problems.push(`${doc} §${sectionKey}: new section since the last recording — re-record it`);
      }
    }
  }
}

const pairCount = Object.keys(record).length;

if (problems.length > 0) {
  console.error(`translation pairing failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  console.error('\nFix both sides, then re-record with `npm run verify-i18n -- --write`.');
  process.exit(1);
}

if (WRITE) {
  const existing = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};
  const payload = {
    $comment:
      'Bilingual pairing record. Each entry hashes one heading section of the English and Chinese blocks, ' +
      'excluding fenced code blocks and the language switcher. Re-record with `npm run verify-i18n -- --write`.',
    ...existing,
    pairs: record,
  };
  writeFileSync(RECORD, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`recorded ${pairCount} document pair(s) to ${rel(RECORD)}`);
} else {
  console.log(`translation pairing passed: ${pairCount} document pairs are in sync.`);
}
