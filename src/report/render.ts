import type { Report, ReportFinding } from './build.js';

/**
 * Three renderings of one report object.
 *
 * They are separate on purpose. A machine consumer needs a stable shape it can
 * `JSON.parse`; a terminal needs alignment; a document needs headings a reader
 * can skim and a table a reviewer can comment on. Making any one of them "one
 * of the others with padding" produces something that serves nobody.
 *
 * All three read the same `Report`, so they cannot disagree about a number.
 * `tests/report-render.test.ts` asserts exactly that.
 */

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export interface TextOptions {
  /** Include the per-policy table. Defaults to true. */
  include_policies?: boolean;
}

/** Fixed-width text for a terminal. */
export function renderText(report: Report, options: TextOptions = {}): string {
  const lines: string[] = [];
  const summary = report.summary;

  lines.push(`AgentGate report — generated ${report.generated_at}`);
  lines.push(
    report.window === null
      ? 'audit window: empty (no records)'
      : `audit window: ${report.window.from} → ${report.window.to}`,
  );
  lines.push('');

  lines.push('Summary');
  lines.push(`  policies        ${summary.policies} (${summary.policies_seen} with history)`);
  lines.push(`  events          ${summary.events}`);
  lines.push(`  presented       ${summary.presented}`);
  lines.push(`  approved        ${summary.approved}`);
  lines.push(`  dismissed       ${summary.dismissed}`);
  lines.push(`  throttled       ${summary.throttled}`);
  lines.push(`  degraded        ${summary.degraded}`);
  lines.push(`  approval rate   ${formatRate(summary.approval_rate)}`);
  lines.push('');

  lines.push('Lifecycle');
  for (const state of LIFECYCLE_ORDER) {
    lines.push(`  ${state.padEnd(12)} ${report.lifecycle[state]}`);
  }
  lines.push('');

  if (options.include_policies !== false && report.policies.length > 0) {
    lines.push('Policies');
    const header = ['policy', 'state', 'shown', 'approved', 'dismissed', 'throttled', 'reject'];
    const rows = report.policies.map((policy) => [
      policy.policy_id,
      policy.state,
      String(policy.presented),
      String(policy.approved),
      String(policy.dismissed),
      String(policy.throttled),
      formatRate(policy.rejection_rate),
    ]);
    lines.push(...alignTable(header, rows));
    lines.push('');
  }

  if (report.findings.length === 0) {
    lines.push('Findings');
    lines.push('  none');
  } else {
    lines.push('Findings');
    for (const finding of report.findings) {
      const scope = finding.policy_id === null ? '(all)' : finding.policy_id;
      lines.push(`  ${scope}: ${finding.code}`);
      lines.push(`    ${finding.message}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

export interface MarkdownOptions {
  /** Include the per-policy table. Defaults to true. */
  include_policies?: boolean;
  /**
   * Document title. Defaults to `AgentGate report`. A caller posting this into
   * an issue usually wants the title to name the window or the profile.
   */
  title?: string;
}

/**
 * A Markdown document, for review rather than for reading in place.
 *
 * The shape is chosen for the place it lands: an issue, a pull request comment,
 * a run summary. That means a heading a reviewer can link to, a table with one
 * row per policy they can comment on, and findings as a list with the code
 * inline — not a code block containing padded columns, which is unreadable
 * outside a monospace font and cannot be commented on.
 */
export function renderMarkdown(report: Report, options: MarkdownOptions = {}): string {
  const summary = report.summary;
  const lines: string[] = [];

  lines.push(`# ${options.title ?? 'AgentGate report'}`);
  lines.push('');
  lines.push(
    report.window === null
      ? '_Audit window: empty — no records._'
      : `_Audit window: ${report.window.from} → ${report.window.to}_`,
  );
  lines.push('');
  lines.push(`Generated ${report.generated_at}.`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Policies | ${summary.policies} (${summary.policies_seen} with history) |`);
  lines.push(`| Events | ${summary.events} |`);
  lines.push(`| Presented | ${summary.presented} |`);
  lines.push(`| Approved | ${summary.approved} |`);
  lines.push(`| Dismissed | ${summary.dismissed} |`);
  lines.push(`| Throttled | ${summary.throttled} |`);
  lines.push(`| Degraded | ${summary.degraded} |`);
  // `n/a` rather than 0%: "nobody answered" is not "everyone refused".
  lines.push(`| Approval rate | ${formatRate(summary.approval_rate)} |`);
  lines.push('');

  lines.push('## Lifecycle');
  lines.push('');
  lines.push('| State | Count |');
  lines.push('| --- | --- |');
  for (const state of LIFECYCLE_ORDER) {
    lines.push(`| \`${state}\` | ${report.lifecycle[state]} |`);
  }
  lines.push('');

  if (options.include_policies !== false && report.policies.length > 0) {
    lines.push('## Policies');
    lines.push('');
    lines.push('| Policy | State | Shown | Approved | Dismissed | Throttled | Rejection rate |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
    for (const policy of report.policies) {
      lines.push(
        `| \`${policy.policy_id}\` | \`${policy.state}\` | ${policy.presented} | ${policy.approved} | ` +
          `${policy.dismissed} | ${policy.throttled} | ${formatRate(policy.rejection_rate)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Findings');
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('None.');
  } else {
    for (const finding of report.findings) {
      lines.push(`- ${describeFinding(finding)}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

const LIFECYCLE_ORDER = ['draft', 'validated', 'active', 'muted', 'archived'] as const;

/** One finding as a list item: scope, code, then the human explanation. */
function describeFinding(finding: ReportFinding): string {
  const scope = finding.policy_id === null ? '**all policies**' : `\`${finding.policy_id}\``;
  return `${scope} — \`${finding.code}\`: ${finding.message}`;
}

/** `null` means "not enough answers to compute a rate", which is not 0%. */
function formatRate(rate: number | null): string {
  if (rate === null) return 'n/a';
  return `${Math.round(rate * 100)}%`;
}

/** Pad each column to its widest cell; the last column is not padded. */
function alignTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => (row[index] ?? '').length)),
  );

  const format = (row: readonly string[]): string =>
    row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? cell.length))).join('  ');

  return [
    `  ${format(header)}`,
    `  ${format(header.map((cell) => '-'.repeat(cell.length)))}`,
    ...rows.map((row) => `  ${format(row)}`),
  ];
}
