/**
 * Assert that the Linux matrix job runs every gate `npm run check` runs.
 *
 * `npm run check` covers everything on Windows. The Linux matrix deliberately
 * lists steps individually so a failure names the gate — but a listed sequence
 * drifts, and it did: four gates added to `check` never reached the workflow,
 * so three Node versions ran a weaker suite than Windows and nothing noticed.
 *
 * That is why this script does not let "some job calls `check`" excuse the
 * matrix job. It extracts the steps of the job that does *not* call `check` and
 * compares them gate for gate.
 */

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

/** Scripts invoked by `npm run check`. */
const checkScripts = [...(pkg.scripts['check'] ?? '').matchAll(/npm run ([a-z:0-9-]+)/g)]
  .map((match) => match[1] ?? '')
  .filter((name) => name !== '');

if (checkScripts.length === 0) {
  console.error('package.json has no `check` script');
  process.exit(1);
}

/**
 * Split the workflow into jobs by their `  <name>:` keys under `jobs:`.
 * Indentation is two spaces for a job, four for a step.
 */
function jobBlocks(text: string): Map<string, string[]> {
  const jobs = new Map();
  const lines = text.split('\n');
  let current = null;

  for (const line of lines) {
    const jobStart = /^ {2}([a-zA-Z0-9_-]+):\s*$/.exec(line);
    if (jobStart !== null) {
      current = jobStart[1];
      jobs.set(current, []);
      continue;
    }
    if (current !== null) jobs.get(current)?.push(line);
  }
  return jobs;
}

const jobs = jobBlocks(workflow);
const matrixJob = [...jobs.entries()].find(([, body]: [string, string[]]) => body.join('\n').includes('matrix.node'));

if (matrixJob === undefined) {
  console.error('no matrix job found in ci.yml');
  process.exit(1);
}

const [jobName, jobLines] = matrixJob;
const jobText = jobLines.join('\n');

// Only a `run:` line counts as an invocation. A step *name* that mentions
// the command is not one — and treating it as one silently disables this check.
const runLines = jobLines.filter((line: string) => /^\s*run:/.test(line)).join('\n');
if (/npm run check\b/.test(runLines)) {
  console.log(`ci-coverage passed: job "${jobName}" calls \`npm run check\`.`);
  process.exit(0);
}

// `test` may be invoked as the `npm test` shorthand, so match either form.
const runs = (script: string): boolean => {
  const escaped = script.replace(/:/g, '\\:');
  return new RegExp(`npm (?:run )?${escaped}\\b`).test(runLines);
};
const missing = checkScripts.filter((script) => !runs(script));

if (missing.length > 0) {
  console.error(
    `job "${jobName}" is missing ${missing.length} gate(s) that \`npm run check\` runs:\n`,
  );
  for (const script of missing) console.error(`  ✖ npm run ${script}`);
  console.error('\nAdd them to the matrix job, or make it call `npm run check`.');
  process.exit(1);
}

console.log(
  `ci-coverage passed: job "${jobName}" runs all ${checkScripts.length} gates from \`npm run check\`.`,
);
