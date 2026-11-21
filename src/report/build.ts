import type { AuditRecord } from '../audit/store.js';
import type { Policy } from '../policy/types.js';
import { projectLifecycle, type ArchiveRequest, type LifecycleState, type PolicyLifecycle } from '../policy/lifecycle.js';
import { suggestRevisions, type PolicySuggestion } from './suggest.js';

/**
 * Aggregation for `gate report`.
 *
 * Same discipline as the lifecycle projection: this is a **pure function of
 * the audit log**, not a second bookkeeping store. Everything it prints can be
 * recomputed from the log at any time, which is what makes the numbers
 * trustworthy rather than merely persistent.
 *
 * Contract: docs/10-report-spec.md.
 */

/** One policy's line in the report. */
export interface PolicyReport {
  policy_id: string;
  state: LifecycleState;
  /** How many times the policy produced a signal the user could see. */
  presented: number;
  approved: number;
  dismissed: number;
  muted_short: number;
  /** Matches the engine suppressed because the presentation window was still open. */
  throttled: number;
  /** Evaluations that failed and degraded to allow. */
  degraded: number;
  /** dismissals / (approved + dismissed), or null when nobody answered. */
  rejection_rate: number | null;
  consecutive_dismissals: number;
  muted_until: string | null;
  /** Earliest and latest audit timestamps for this policy. */
  first_seen: string | null;
  last_seen: string | null;
}

export interface ReportSummary {
  /** Policies considered, whether or not they have history. */
  policies: number;
  /** Policies with at least one audit record. */
  policies_seen: number;
  events: number;
  presented: number;
  approved: number;
  dismissed: number;
  throttled: number;
  degraded: number;
  /** approved / (approved + dismissed), or null when nobody answered. */
  approval_rate: number | null;
}

export interface ReportLifecycleCounts {
  draft: number;
  validated: number;
  active: number;
  muted: number;
  archived: number;
}

/**
 * Signals worth pointing at. Each entry is derived, so it disappears on its own
 * once the condition stops holding — there is nothing to clean up.
 */
export interface ReportFinding {
  code: FindingCode;
  policy_id: string | null;
  message: string;
}

export const FINDING_CODES = [
  'policy_never_presented',
  'high_rejection_rate',
  'muted',
  'degraded_evaluations',
  'heavily_throttled',
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export interface Report {
  /** Instant the report was computed for; passed in, never read from a clock. */
  generated_at: string;
  /** Inclusive range actually covered, or null when the log is empty. */
  window: { from: string; to: string } | null;
  summary: ReportSummary;
  lifecycle: ReportLifecycleCounts;
  policies: PolicyReport[];
  findings: ReportFinding[];
  /**
   * Concrete revisions to consider, one per repeatedly-dismissed policy.
   *
   * Separate from indings on purpose: a finding says something is wrong,
   * a suggestion says what to change. They carry different evidence and a
   * reader should be able to act on one without reading the other.
   */
  suggestions: PolicySuggestion[];
}

export interface BuildReportOptions {
  /** Reference instant for bounded-mute expiry. */
  now?: Date;
  /** Operator archives, forwarded to the lifecycle projection. */
  archives?: readonly ArchiveRequest[];
  /** A policy is flagged when its rejection rate reaches this (0..1). */
  rejection_threshold?: number;
  /** A policy is flagged after this many throttle records. */
  throttle_threshold?: number;
  /** IANA zone used to bucket dismissal times for suggestions. */
  timezone?: string;
}

const DEFAULT_REJECTION_THRESHOLD = 0.5;
const DEFAULT_THROTTLE_THRESHOLD = 3;

export function buildReport(
  policies: readonly Policy[],
  audit: readonly AuditRecord[],
  options: BuildReportOptions = {},
): Report {
  const now = options.now ?? new Date();
  const rejectionThreshold = options.rejection_threshold ?? DEFAULT_REJECTION_THRESHOLD;
  const throttleThreshold = options.throttle_threshold ?? DEFAULT_THROTTLE_THRESHOLD;

  const lifecycles = projectLifecycle(policies, audit, now, { archives: options.archives ?? [] });
  const lifecycleById = new Map(lifecycles.map((entry) => [entry.policy_id, entry]));

  const byPolicy = new Map<string, AuditRecord[]>();
  for (const record of audit) {
    const bucket = byPolicy.get(record.policy_id);
    if (bucket === undefined) byPolicy.set(record.policy_id, [record]);
    else bucket.push(record);
  }

  /**
   * A degraded evaluation is written with `policy_id: 'none'`: when a policy
   * throws, the engine cannot attribute the line to it without trusting the
   * code that just failed. That default is right for the audit trail, but it
   * means a per-policy count silently reports zero forever.
   *
   * So degradation is counted from the log itself, globally, and attributed
   * per policy only when the log actually names one. The summary is therefore
   * always honest; the per-policy column says `0` only when there is no
   * evidence pointing at that policy.
   */
  const degradedTotal = audit.filter((record) => record.reason === 'degraded').length;

  const reports: PolicyReport[] = policies.map((policy) => {
    const records = byPolicy.get(policy.id) ?? [];
    const lifecycle = lifecycleById.get(policy.id);

    const approved = records.filter((record) => record.reason === 'user_approved').length;
    const dismissed = records.filter((record) => record.reason === 'user_dismissed').length;

    return {
      policy_id: policy.id,
      state: lifecycle?.state ?? 'validated',
      presented: records.filter((record) => record.reason === 'matched').length,
      approved,
      dismissed,
      muted_short: records.filter((record) => record.reason === 'user_muted').length,
      throttled: records.filter((record) => record.reason === 'rate_limited').length,
      degraded: records.filter((record) => record.reason === 'degraded').length,
      rejection_rate: ratio(dismissed, approved + dismissed),
      consecutive_dismissals: lifecycle?.consecutive_dismissals ?? 0,
      muted_until: lifecycle?.muted_until ?? null,
      first_seen: records.length === 0 ? null : earliest(records),
      last_seen: records.length === 0 ? null : latest(records),
    };
  });

  const active = reports.filter((report) => report.presented > 0);
  const approved = sum(reports, (report) => report.approved);
  const dismissed = sum(reports, (report) => report.dismissed);

  const summary: ReportSummary = {
    policies: policies.length,
    policies_seen: reports.filter((report) => report.first_seen !== null).length,
    events: new Set(audit.map((record) => record.event_id)).size,
    presented: sum(reports, (report) => report.presented),
    approved,
    dismissed,
    throttled: sum(reports, (report) => report.throttled),
    degraded: degradedTotal,
    approval_rate: ratio(approved, approved + dismissed),
  };

  const timestamps = audit.map((record) => record.timestamp).sort();
  const window =
    timestamps.length === 0
      ? null
      : { from: timestamps[0] as string, to: timestamps[timestamps.length - 1] as string };

  return {
    generated_at: now.toISOString(),
    window,
    summary,
    lifecycle: countLifecycle(lifecycles),
    policies: reports,
    findings: deriveFindings(reports, active.length, rejectionThreshold, throttleThreshold),
    suggestions: suggestRevisions(policies, audit, {
      ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
      now,
    }),
  };
}

function deriveFindings(
  reports: readonly PolicyReport[],
  presentedAnywhere: number,
  rejectionThreshold: number,
  throttleThreshold: number,
): ReportFinding[] {
  const findings: ReportFinding[] = [];

  // Applied to any policy that has been evaluated but never once reached the
  // user: either the trigger never fires, or every match is being throttled.
  for (const report of reports) {
    if (report.presented === 0 && (report.throttled > 0 || report.degraded > 0)) {
      findings.push({
        code: 'policy_never_presented',
        policy_id: report.policy_id,
        message: 'evaluated but never shown to the user; check the trigger and the presentation window',
      });
    }
  }

  // Only a log with history can be "silent". An empty log is the absence of
  // data, not a finding: reporting it would train people to ignore findings.
  const hasHistory = reports.some((report) => report.first_seen !== null);
  if (hasHistory && presentedAnywhere === 0) {
    findings.push({
      code: 'policy_never_presented',
      policy_id: null,
      message: 'no policy has ever produced a visible signal for this audit log',
    });
  }

  for (const report of reports) {
    if (report.rejection_rate !== null && report.rejection_rate >= rejectionThreshold && report.dismissed >= 2) {
      findings.push({
        code: 'high_rejection_rate',
        policy_id: report.policy_id,
        message: `${report.dismissed} of ${report.dismissed + report.approved} answers were dismissals; the condition is probably too broad`,
      });
    }
    if (report.state === 'muted') {
      findings.push({
        code: 'muted',
        policy_id: report.policy_id,
        message:
          report.muted_until === null
            ? 'muted until the user approves or unmutes it'
            : `muted until ${report.muted_until}`,
      });
    }
    if (report.degraded > 0) {
      findings.push({
        code: 'degraded_evaluations',
        policy_id: report.policy_id,
        message: `${report.degraded} evaluation(s) failed and degraded to allow`,
      });
    }
    if (report.throttled >= throttleThreshold) {
      findings.push({
        code: 'heavily_throttled',
        policy_id: report.policy_id,
        message: `rate limited ${report.throttled} time(s); the presentation window may be too long`,
      });
    }
  }

  return findings;
}

function countLifecycle(lifecycles: readonly PolicyLifecycle[]): ReportLifecycleCounts {
  const counts: ReportLifecycleCounts = { draft: 0, validated: 0, active: 0, muted: 0, archived: 0 };
  for (const entry of lifecycles) {
    counts[entry.state] += 1;
  }
  return counts;
}

function sum(reports: readonly PolicyReport[], pick: (report: PolicyReport) => number): number {
  return reports.reduce((total, report) => total + pick(report), 0);
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function earliest(records: readonly AuditRecord[]): string {
  return records.reduce((best, record) => (record.timestamp < best ? record.timestamp : best), records[0]!.timestamp);
}

function latest(records: readonly AuditRecord[]): string {
  return records.reduce((best, record) => (record.timestamp > best ? record.timestamp : best), records[0]!.timestamp);
}
