import type { Report } from './build.js';

/**
 * Two renderings of one report object.
 *
 * They are separate on purpose. A machine consumer needs a stable shape it can
 * `JSON.parse`; a human needs alignment and a total that is not buried. Making
 * the human view "the JSON with some padding" produces something that serves
 * neither. Both read the same `Report`, so they cannot disagree about a number.
 */

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export interface TextOptions {
  /** Include the per-policy table. Defaults to true. */
  include_policies?: boolean;
}

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
  for (const state of ['draft', 'validated', 'active', 'muted', 'archived'] as const) {
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

  return [`  ${format(header)}`, `  ${format(header.map((cell) => '-'.repeat(cell.length)))}`, ...rows.map((row) => `  ${format(row)}`)];
}
