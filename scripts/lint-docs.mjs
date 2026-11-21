#!/usr/bin/env node
/**
 * Documentation lint.
 *
 * `verify-i18n` owns pairing and drift; this script owns the *format* rules a
 * reader never notices until they are broken: frontmatter fields, heading
 * level order, code-fence language tags, line endings, and the "no text in
 * images" rule that has no other mechanical check.
 *
 * Every rule here corresponds to a line in `docs-checklist.md`. The point is
 * not to enforce taste — it is that a rule with no checker is a rule that is
 * skipped under deadline.
 *
 *   npm run lint-docs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * Chinese is the source of truth; English and any future language are
 * translations of it. The *directory* per language is still the right layout
 * (translation platforms and docs sites both expect it) — only the direction of
 * authorship changed.
 */
const SOURCE_TREE = 'docs/zh-cn';
const SOURCE_LANG = 'zh-cn';
const TREES = [SOURCE_TREE, 'docs/en'];
const REQUIRED_TRANSLATIONS = ['docs/en'];
const REQUIRED_FRONTMATTER = ['title', 'sidebar_position', 'tags', 'description', 'last_updated'];

/** Files allowed to hold more than one H1: a page that quotes an artifact verbatim. */
const MULTI_H1_ALLOWED = new Set(['docs/en/06-compiler-spec.md', 'docs/zh-cn/06-compiler-spec.md']);

const problems = [];

function walk(tree, base = tree, out = []) {
  for (const entry of readdirSync(tree, { withFileTypes: true })) {
    const absolute = path.join(tree, entry.name);
    if (entry.isDirectory()) walk(absolute, base, out);
    else if (entry.name.endsWith('.md')) out.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return out.sort();
}

for (const tree of TREES) {
  const absoluteTree = path.join(ROOT, tree);
  for (const relative of walk(absoluteTree)) {
    const file = `${tree}/${relative}`;
    const text = readFileSync(path.join(ROOT, file), 'utf8');

    // Line endings: LF everywhere. A CRLF file breaks a naive `^---` read and
    // makes diffs noisy for everyone else.
    if (text.includes('\r\n')) problems.push(`${file}: contains CRLF line endings`);
    if (text.charCodeAt(0) === 0xfeff) problems.push(`${file}: starts with a byte-order mark`);

    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (frontmatter === null) {
      problems.push(`${file}: no frontmatter`);
      continue;
    }
    for (const field of REQUIRED_FRONTMATTER) {
      if (!new RegExp(`^${field}:`, 'm').test(frontmatter[1])) {
        problems.push(`${file}: frontmatter is missing "${field}"`);
      }
    }

    const body = text.slice(frontmatter[0].length);
    const h1Count = [...body.matchAll(/^#\s/gm)].length;
    if (h1Count !== 1 && !MULTI_H1_ALLOWED.has(file)) {
      problems.push(`${file}: ${h1Count} top-level headings, expected 1`);
    }

    let previousLevel = 0;
    let inFence = false;
    let fenceOpen = false;
    const lines = body.split('\n');

    lines.forEach((line, index) => {
      const fence = /^\s*```(\S*)/.exec(line);
      if (fence !== null) {
        if (!inFence && fence[1] === '') {
          problems.push(`${file}:${index + 1}: code fence has no language tag`);
        }
        inFence = !inFence;
        fenceOpen = inFence;
        return;
      }
      if (inFence) return;

      const heading = /^(#{1,6})\s/.exec(line);
      if (heading !== null) {
        const level = heading[1].length;
        if (previousLevel > 0 && level > previousLevel + 1) {
          problems.push(`${file}:${index + 1}: heading level jumps ${previousLevel} -> ${level}`);
        }
        previousLevel = level;
      }
    });

    if (fenceOpen) problems.push(`${file}: unclosed code fence`);

    // Images must carry alt text, and must not carry the meaning in the image.
    for (const image of body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      if ((image[1] ?? '').trim() === '') {
        problems.push(`${file}: image "${image[2]}" has no alt text`);
      }
    }

    // `translation_status` is a translation-only field. Chinese is the source of
    // truth, so it must appear in every English page and in no Chinese page, so
    // a reader can tell at a glance whether what they are reading has been
    // reviewed against the original.
    const declaresStatus = /^translation_status:/m.test(frontmatter[1]);
    if (tree === SOURCE_TREE && declaresStatus) {
      problems.push(`${file}: the source language must not declare translation_status`);
    }
    if (tree !== SOURCE_TREE && !declaresStatus) {
      problems.push(`${file}: a translated page must declare translation_status`);
    }
    if (declaresStatus) {
      const status = /^translation_status:\s*(\S+)/m.exec(frontmatter[1])?.[1];
      if (!['complete', 'partial', 'todo'].includes(status ?? '')) {
        problems.push(`${file}: translation_status "${status}" is not complete/partial/todo`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Site-rendering hazards.
//
// A Markdown file is also a Vue template once a docs site renders it. Two things
// that read fine as plain text break the build:
//
//   1. `<placeholder>` in prose. CommonMark passes it through as raw HTML and Vue
//      rejects it with "Element is missing end tag", reported on another line.
//   2. A relative link to a file outside the site root. It resolves on disk and
//      fails at build time as a dead link.
//
// Both were found by the first `docs:build`; checking them here means the next
// author is told by the linter, not by a stack trace.
// ---------------------------------------------------------------------------

const REAL_HTML_TAGS = new Set([
  'a', 'b', 'i', 'u', 'em', 'strong', 'code', 'pre', 'kbd', 'samp', 'var',
  'br', 'hr', 'p', 'div', 'span', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'details', 'summary', 'sup', 'sub', 'small', 'mark', 'del', 'ins',
  'video', 'audio', 'source', 'picture', 'figure', 'figcaption', 'iframe',
  'svg', 'path', 'button', 'input', 'label', 'form', 'select', 'option', 'textarea',
]);

const SITE_ROOT = path.join(ROOT, 'docs');

for (const tree of TREES) {
  const absoluteTree = path.join(ROOT, tree);
  for (const relative of walk(absoluteTree)) {
    const file = `${tree}/${relative}`;
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const lines = text.split('\n');

    let inFence = false;
    lines.forEach((line, index) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;

      // Unescaped placeholder, not a real element.
      for (const match of line.matchAll(/<([a-z][a-z0-9-]*)>/g)) {
        if (!REAL_HTML_TAGS.has(match[1])) {
          problems.push(
            `${file}:${index + 1}: "<${match[1]}>" is a placeholder; escape it as ` +
              `&lt;${match[1]}&gt; or the docs site fails to compile the page`,
          );
        }
      }

      // Relative link escaping the site root.
      for (const match of line.matchAll(/\]\((\.\.\/[^)#\s]+)/g)) {
        const resolved = path.resolve(path.dirname(path.join(ROOT, file)), match[1]);
        if (!resolved.startsWith(SITE_ROOT + path.sep)) {
          problems.push(
            `${file}:${index + 1}: link "${match[1]}" leaves the documentation root; ` +
              `use an absolute repository URL instead`,
          );
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Navigation targets must exist as pages.
//
// The sidebar is written by hand and does not go through link resolution, so a
// stale entry is invisible to every other check: the build succeeds, the page
// builds, and the link 404s only once someone clicks it in a browser. This
// happened with `/README`, which is the *source* path of the index page while
// the site serves it at `/` because of `rewrites`.
//
// Each sidebar link is mapped the same way the build maps it, then compared with
// the pages that actually exist.
// ---------------------------------------------------------------------------

const CONFIG = path.join(ROOT, 'docs', '.vitepress', 'config.mjs');
if (existsSync(CONFIG)) {
  const config = readFileSync(CONFIG, 'utf8');

  /** Pages that will exist on the site, as clean URLs without a trailing slash. */
  const sitePages = new Set(['/']);
  for (const tree of TREES) {
    for (const relative of walk(path.join(ROOT, tree))) {
      const slug = relative.replace(/\.md$/, '');
      // The source tree is rewritten to the root; the translation keeps its dir.
      const served = tree === SOURCE_TREE ? slug : `${tree.replace(/^docs\//, '')}/${slug}`;

      // `README` becomes the directory index, so it is served as the directory
      // itself rather than as `/README`.
      const isIndex = slug === 'README' || slug.endsWith('/README');
      const withoutIndex = served.replace(/\/?README$/, '');
      const clean = `/${withoutIndex}`.replace(/\/$/, '') || '/';

      sitePages.add(clean);
      sitePages.add(`${clean === '/' ? '' : clean}/`);
      if (isIndex) sitePages.add(withoutIndex === '' ? '/' : `/${withoutIndex}/`);
    }
  }

  for (const match of config.matchAll(/link:\s*'(\/[^']*)'/g)) {
    const target = match[1];
    const normalised = target.replace(/\/$/, '') || '/';
    if (sitePages.has(normalised) || sitePages.has(target)) continue;
    problems.push(
      `docs/.vitepress/config.mjs: sidebar link "${target}" has no page; ` +
        `the site serves the index at "/" because rewrites map README to index`,
    );
  }

  // A root-level `nav` in `themeConfig` overrides the per-locale one, so it
  // silently puts one language's header on every page. This shipped once: the
  // English site showed "概览 / 架构 / 策略 DSL" and every link led into the
  // Chinese tree. Navigation must live in `locales.<lang>.themeConfig`.
  const rootNav = /themeConfig:\s*\{[\s\S]*?^\s{4}nav:\s*\[/m.test(config);
  if (rootNav) {
    problems.push(
      'docs/.vitepress/config.mjs: `nav` at the root of themeConfig overrides every ' +
        'locale; define it under `locales.<lang>.themeConfig` instead',
    );
  }

  // A `/en/` page must not link into the Chinese tree, and vice versa.
  const enBlock = /en:\s*\{[\s\S]*?nav:\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? '';
  for (const match of enBlock.matchAll(/link:\s*'(\/[^']*)'/g)) {
    if (!match[1].startsWith('/en/')) {
      problems.push(
        `docs/.vitepress/config.mjs: English nav entry "${match[1]}" leaves the /en/ tree`,
      );
    }
  }
}

// The two trees must hold exactly the same page set.
const enPages = walk(path.join(ROOT, 'docs/en'));
const zhPages = walk(path.join(ROOT, 'docs/zh-cn'));
if (JSON.stringify(enPages) !== JSON.stringify(zhPages)) {
  const missingInZh = enPages.filter((page) => !zhPages.includes(page));
  const extraInZh = zhPages.filter((page) => !enPages.includes(page));
  if (missingInZh.length > 0) problems.push(`docs/zh-cn is missing: ${missingInZh.join(', ')}`);
  if (extraInZh.length > 0) problems.push(`docs/zh-cn has pages absent from docs/en: ${extraInZh.join(', ')}`);
}

if (problems.length > 0) {
  console.error(`documentation lint failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `documentation lint passed: ${enPages.length} pages per tree, frontmatter and Markdown rules hold.`,
  );
}
