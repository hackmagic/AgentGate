import { readFileSync } from 'node:fs';

import { ENGINE_VERSION } from '../src/version.js';

/**
 * Assert that the roadmap's status line names the shipped version.
 *
 * The roadmap exists to be the honest progress document, and its one-line
 * status was two majors and three milestones behind while the tables below it
 * were current. A reader who trusts the summary never scrolls to the detail —
 * so a stale summary is the only part of this page that gets read.
 *
 * This check compares the summary against `src/version.ts`. Bumping the
 * version without touching the roadmap now fails the build, which is the point:
 * the line stops being decoration and becomes a constraint.
 */

const FILES = ['docs/zh-cn/09-mvp-roadmap.md', 'docs/en/09-mvp-roadmap.md'];

const problems = [];

for (const file of FILES) {
  const text = readFileSync(file, 'utf8');

  // The status line carries the version in parentheses: `（v0.11.2）` or `(v0.11.2)`.
  const match = /(?:状态|Status)[^\n]*?[（(]v(\d+\.\d+\.\d+)[)）]/.exec(text);
  if (match === null) {
    problems.push(`${file}: no version found in the status line`);
    continue;
  }
  if (match[1] !== ENGINE_VERSION) {
    problems.push(`${file}: status line says v${match[1]}, shipped version is ${ENGINE_VERSION}`);
  }

  // The roadmap must also name its last milestone, and the table must contain it.
  const milestones = [...text.matchAll(/^## (M\d+) · /gm)].map((head) => head[1] ?? '');
  if (milestones.length === 0) {
    problems.push(`${file}: no milestone headings`);
    continue;
  }
  const highest = Math.max(...milestones.map((name) => Number(name.slice(1))));
  const claimed = /(?:M0–M|kernel of M0–M|状态：M0–M)(\d+)/.exec(text);
  if (claimed !== null && Number(claimed[1]) !== highest) {
    problems.push(`${file}: status says through M${claimed[1]}, the document reaches M${highest}`);
  }

  // An item recorded as open under one milestone and delivered in another is a
  // contradiction, not a backlog.
  const open = [...text.matchAll(/^- ⬜ (.+)$/gm)].map((line) => line[1] ?? '');
  const done = [...text.matchAll(/^- ✅ (.+)$/gm)].map((line) => line[1] ?? '');
  for (const item of open) {
    const keyword = item.split(/[：:（(，,]/)[0]?.trim() ?? '';
    if (keyword.length < 4) continue;
    const shadowed = done.some((entry) => entry.includes(keyword));
    if (shadowed) problems.push(`${file}: "${item.slice(0, 40)}…" is open, yet a ✅ line mentions the same subject`);
  }
}

if (problems.length > 0) {
  console.error(`roadmap freshness failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  process.exit(1);
}

console.log(`roadmap freshness passed: both files state v${ENGINE_VERSION} and agree with their own tables.`);
