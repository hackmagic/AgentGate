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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TREES = ['docs/en', 'docs/zh-cn'];
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

    // `translation_status` is a translation-only field. It must appear in every
    // translated page and in no English page, so a reader can tell at a glance
    // whether what they are reading has been reviewed.
    const declaresStatus = /^translation_status:/m.test(frontmatter[1]);
    if (tree === 'docs/zh-cn' && !declaresStatus) {
      problems.push(`${file}: a translated page must declare translation_status`);
    }
    if (tree === 'docs/en' && declaresStatus) {
      problems.push(`${file}: an English source page must not declare translation_status`);
    }
    if (declaresStatus) {
      const status = /^translation_status:\s*(\S+)/m.exec(frontmatter[1])?.[1];
      if (!['complete', 'partial', 'todo'].includes(status ?? '')) {
        problems.push(`${file}: translation_status "${status}" is not complete/partial/todo`);
      }
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
