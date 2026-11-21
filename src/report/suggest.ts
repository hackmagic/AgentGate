import type { AuditRecord } from '../audit/store.js';
import type { Policy } from '../policy/types.js';

/**
 * Revision suggestions: turn repeated dismissals into a concrete change.
 *
 * The roadmap asks for "after repeated dismissals, propose a concrete condition
 * change". The hard part is not generating prose — it is deciding what this
 * system can *honestly* say, because the audit whitelist is the only data
 * available and it is deliberately narrow.
 *
 * `AUDIT_FIELD_WHITELIST` is: event_id, policy_id, decision, signal_id,
 * user_response, timestamp, engine_version, degraded, reason.
 *
 * It contains **no event context and no trigger conditions**. So the system
 * cannot know that a dismissal happened on a Tuesday meeting, or in a
 * particular app. Any suggestion implying that would be invented.
 *
 * What it does know is *when*, exactly. That makes one claim defensible:
 * **the dismissals cluster in a time range the policy currently covers.** A
 * narrowed `time_window` is then a checkable proposal, and the user can accept
 * or reject it against their own memory.
 *
 * Everything else returns no suggestion. "I do not have the evidence" is a
 * better answer than a plausible-sounding guess the user cannot falsify.
 */

export interface SuggestionOptions {
  /** IANA zone, so hour buckets mean what the policy means. */
  timezone?: string;
  /** Minimum dismissals before a suggestion is worth making. */
  min_dismissals?: number;
  /** A bucket must hold at least this share of dismissals to be proposed. */
  min_bucket_share?: number;
  /** Width of each hour bucket, in hours. */
  bucket_hours?: number;
  now?: Date;
}

export type SuggestionKind = 'narrow_time_window';

export interface PolicySuggestion {
  policy_id: string;
  kind: SuggestionKind;
  /** One-line headline, safe to show without further context. */
  summary: string;
  /** Why this is being proposed, with the numbers that support it. */
  evidence: {
    dismissals: number;
    approvals: number;
    /** The hour buckets that hold the dismissals, `HH:00-HH:00`. */
    buckets: { window: string; dismissals: number }[];
    /** Share of dismissals inside the proposed window, 0..1. */
    concentration: number;
  };
  /**
   * The change to consider, as a diff the user can apply or reject. `null`
   * when the policy has no `time_window` to narrow — the caller must show the
   * evidence without pretending to know the fix.
   */
  proposed_change: { field: 'time_window'; from: string | null; to: string } | null;
  /** Caveats a reader needs to judge the suggestion. Always non-empty. */
  caveats: string[];
}

const DEFAULT_MIN_DISMISSALS = 3;
const DEFAULT_MIN_BUCKET_SHARE = 0.6;
const DEFAULT_BUCKET_HOURS = 2;

/**
 * Suggest revisions for every policy that has been dismissed repeatedly.
 *
 * Pure: no clock, no I/O. `now` and `timezone` come from the caller.
 */
export function suggestRevisions(
  policies: readonly Policy[],
  audit: readonly AuditRecord[],
  options: SuggestionOptions = {},
): PolicySuggestion[] {
  const timezone = options.timezone ?? resolveDefaultTimezone();
  const minDismissals = options.min_dismissals ?? DEFAULT_MIN_DISMISSALS;
  const minShare = options.min_bucket_share ?? DEFAULT_MIN_BUCKET_SHARE;
  const bucketHours = Math.max(1, Math.min(6, options.bucket_hours ?? DEFAULT_BUCKET_HOURS));

  const byPolicy = new Map<string, AuditRecord[]>();
  for (const record of audit) {
    const bucket = byPolicy.get(record.policy_id);
    if (bucket === undefined) byPolicy.set(record.policy_id, [record]);
    else bucket.push(record);
  }

  const suggestions: PolicySuggestion[] = [];

  for (const policy of policies) {
    const records = byPolicy.get(policy.id) ?? [];
    const dismissals = records.filter((record) => record.reason === 'user_dismissed');
    const approvals = records.filter((record) => record.reason === 'user_approved').length;

    if (dismissals.length < minDismissals) continue;

    const buckets = hourBuckets(dismissals, timezone, bucketHours);
    const best = strongestWindow(buckets, bucketHours);
    if (best === null) continue;

    const concentration = best.dismissals / dismissals.length;
    if (concentration < minShare) continue;

    const currentWindow = findTimeWindow(policy.conditions);

    suggestions.push({
      policy_id: policy.id,
      kind: 'narrow_time_window',
      summary:
        `${dismissals.length} of ${dismissals.length + approvals} answers were dismissals, ` +
        `${best.dismissals} of them inside ${best.window}`,
      evidence: {
        dismissals: dismissals.length,
        approvals,
        buckets: buckets.map((entry) => ({ window: entry.window, dismissals: entry.dismissals })),
        concentration: Math.round(concentration * 1000) / 1000,
      },
      proposed_change:
        currentWindow === null
          ? null
          : { field: 'time_window', from: currentWindow, to: best.window },
      caveats: caveatsFor(currentWindow, dismissals.length, bucketHours, bellsCrossMidnight(best.window)),
    });
  }

  return suggestions;
}

interface Bucket {
  startHour: number;
  window: string;
  dismissals: number;
}

/**
 * Bucket dismissal timestamps by local hour.
 *
 * The bucket is anchored at hour 0 and widened, so `08:00-10:00` always means
 * the same thing regardless of when the run happens. Anchoring buckets to the
 * earliest dismissal instead would produce windows that shift between runs and
 * cannot be compared.
 */
function hourBuckets(records: readonly AuditRecord[], timezone: string, size: number): Bucket[] {
  const counts = new Array<number>(24).fill(0);
  for (const record of records) {
    const hour = localHour(record.timestamp, timezone);
    if (hour === null) continue;
    counts[hour] = (counts[hour] ?? 0) + 1;
  }

  const buckets: Bucket[] = [];
  for (let start = 0; start < 24; start += size) {
    let total = 0;
    for (let offset = 0; offset < size && start + offset < 24; offset += 1) {
      total += counts[start + offset] ?? 0;
    }
    if (total === 0) continue;
    const end = Math.min(24, start + size);
    buckets.push({ startHour: start, window: formatWindow(start, end), dismissals: total });
  }
  return buckets;
}

/**
 * The best contiguous run of buckets that covers the most dismissals.
 *
 * A single winning bucket is easy; the interesting case is dismissals spread
 * over two adjacent buckets, where narrowing to one would throw away half the
 * evidence. This grows the window while the average density holds.
 */
function strongestWindow(buckets: readonly Bucket[], size: number): { window: string; dismissals: number } | null {
  if (buckets.length === 0) return null;

  const sorted = [...buckets].sort((a, b) => a.startHour - b.startHour);
  let best = { window: sorted[0]!.window, dismissals: sorted[0]!.dismissals };

  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index]!;
    let total = start.dismissals;
    // Merge with the next bucket only when it is adjacent in time.
    for (let next = index + 1; next < sorted.length; next += 1) {
      const candidate = sorted[next]!;
      const expectedNext = (sorted[next - 1]!.startHour + size) % 24;
      if (candidate.startHour !== expectedNext) break;

      total += candidate.dismissals;
      const window = `${formatHour(start.startHour)}-${formatHour(candidate.startHour + size)}`;
      // Wider only wins when it strictly helps; equal totals keep the narrower
      // window, because the suggestion is to narrow.
      if (total > best.dismissals) best = { window, dismissals: total };
    }
  }

  return best;
}

function caveatsFor(
  currentWindow: string | null,
  dismissals: number,
  bucketHours: number,
  crossesMidnight: boolean,
): string[] {
  const caveats: string[] = [
    'The audit log records when a decision was dismissed, not why. This is a time-of-day signal only.',
    `Buckets are ${bucketHours} hour(s) wide, so the boundary is approximate.`,
  ];

  if (dismissals < 5) {
    caveats.push(`${dismissals} dismissals is a small sample; one or two unusual days could produce this pattern.`);
  }
  if (currentWindow === null) {
    caveats.push('This policy declares no `time_window`, so there is nothing to narrow — add one, or adjust the trigger instead.');
  } else {
    caveats.push(`The policy currently covers \`${currentWindow}\`; the proposal is a subset of the day, not of that window.`);
  }
  if (crossesMidnight) {
    caveats.push('The proposed window crosses midnight, which `time_window` supports but some readers find surprising.');
  }

  return caveats;
}

function bellsCrossMidnight(window: string): boolean {
  const match = /^(\d{2}):00-(\d{2}):00$/.exec(window);
  if (match === null) return false;
  return Number(match[1]) > Number(match[2]);
}

function formatWindow(startHour: number, endHour: number): string {
  return `${formatHour(startHour)}-${formatHour(endHour)}`;
}

function formatHour(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`;
}

/** Local hour of an ISO timestamp, or `null` when it cannot be read. */
function localHour(iso: string, timezone: string): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false });
    const value = formatter.formatToParts(new Date(parsed)).find((part) => part.type === 'hour')?.value;
    if (value === undefined) return null;
    // Some ICU builds render midnight as 24.
    return Number(value) % 24;
  } catch {
    return null;
  }
}

/** First `time_window` anywhere in the condition tree, or `null`. */
function findTimeWindow(condition: unknown): string | null {
  if (Array.isArray(condition)) {
    for (const entry of condition) {
      const found = findTimeWindow(entry);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof condition !== 'object' || condition === null) return null;
  const record = condition as Record<string, unknown>;
  if (typeof record['time_window'] === 'string') return record['time_window'];
  for (const value of Object.values(record)) {
    const found = findTimeWindow(value);
    if (found !== null) return found;
  }
  return null;
}

function resolveDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}
