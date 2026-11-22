import type { AuditRecord } from '../audit/store.js';
import type { Policy } from '../policy/types.js';

/**
 * Lifecycle states, per docs/zh-cn/03-policy-lifecycle.md.
 *
 *   draft → validated → active ⇄ muted → archived
 *                          └──────────────↑
 *
 * `draft` and `validated` are *authoring* facts: does the YAML parse, and does
 * it pass the semantic validator? `active`, `muted` and `archived` are
 * *runtime* facts: is the engine presenting it, has the user silenced it, has
 * it been retired. Only the runtime half is derivable from audit history.
 */
export const LIFECYCLE_STATES = ['draft', 'validated', 'active', 'muted', 'archived'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Why a policy left the `active` set. Recorded by the operator, not inferred. */
export const ARCHIVE_REASONS = ['superseded', 'retired', 'experimental', 'revised'] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

/** Bounded mute applied by the `mute_1h` action. */
export const MUTE_WINDOW_MS = 60 * 60_000;

export interface LifecycleTransition {
  from: LifecycleState;
  to: LifecycleState;
  /** Audit reason that caused it, or `null` for authoring transitions. */
  reason: string | null;
  at: string;
  policy_id: string;
}

export interface ArchiveRequest {
  policy_id: string;
  reason: ArchiveReason;
  at: string;
}

export interface PolicyLifecycle {
  policy_id: string;
  state: LifecycleState;
  /** Instant of the last state change, or `null` when there is no history. */
  since: string | null;
  /** Consecutive dismissals still on the clock (0 after approve or archive). */
  consecutive_dismissals: number;
  /** End of the bounded mute window, if one is in effect. */
  muted_until: string | null;
  transitions: LifecycleTransition[];
}

export interface ProjectLifecycleOptions {
  /**
   * Operator-recorded archives. Kept as an explicit input rather than read
   * from a file so the projection stays a pure function.
   */
  archives?: readonly ArchiveRequest[];
}

/**
 * Fold the audit trail into a lifecycle state per policy.
 *
 * The audit log is the only durable record the engine keeps, so lifecycle is a
 * *projection* of it rather than a second source of truth that can drift.
 * A policy with no audit history is reported as `validated` (known to the
 * engine, never yet presented) — never guessed as `active`.
 */
export function projectLifecycle(
  policies: readonly Policy[],
  audit: readonly AuditRecord[],
  now: Date = new Date(),
  options: ProjectLifecycleOptions = {},
): PolicyLifecycle[] {
  const byPolicy = new Map<string, AuditRecord[]>();
  for (const record of audit) {
    const bucket = byPolicy.get(record.policy_id);
    if (bucket === undefined) byPolicy.set(record.policy_id, [record]);
    else bucket.push(record);
  }

  const archivesByPolicy = new Map<string, ArchiveRequest>();
  for (const archive of options.archives ?? []) archivesByPolicy.set(archive.policy_id, archive);

  return policies.map((policy) =>
    projectOne(policy, byPolicy.get(policy.id) ?? [], now, archivesByPolicy.get(policy.id)),
  );
}

function projectOne(
  policy: Policy,
  records: readonly AuditRecord[],
  now: Date,
  archive: ArchiveRequest | undefined,
): PolicyLifecycle {
  const ordered = [...records].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  // Held in an object so the closures below can mutate it without TypeScript
  // collapsing the union to the literal it was initialised with.
  const cursor: { state: LifecycleState; since: string | null } = { state: 'validated', since: null };
  const transitions: LifecycleTransition[] = [];

  let dismissals = 0;
  let mutedUntil: string | null = null;

  const move = (to: LifecycleState, reason: string | null, at: string): void => {
    if (to === cursor.state) return;
    transitions.push({ from: cursor.state, to, reason, at, policy_id: policy.id });
    cursor.state = to;
    cursor.since = at;
  };

  for (const record of ordered) {
    switch (record.reason) {
      case 'matched':
      case 'degraded':
      case 'rate_limited': {
        // Being evaluated by a live engine means the policy is loaded.
        move('active', record.reason, record.timestamp);
        break;
      }
      case 'user_approved': {
        dismissals = 0;
        mutedUntil = null;
        move('active', record.reason, record.timestamp);
        break;
      }
      case 'user_dismissed': {
        dismissals += 1;
        if (cursor.state === 'validated') move('active', record.reason, record.timestamp);
        break;
      }
      case 'user_muted': {
        // `mute_1h` opens a bounded window and never changes the count
        // (docs/zh-cn/04-policy-dsl.md, rule 5).
        mutedUntil = new Date(Date.parse(record.timestamp) + MUTE_WINDOW_MS).toISOString();
        move('muted', record.reason, record.timestamp);
        break;
      }
      case 'muted': {
        // Unbounded mute after the dismissal threshold.
        mutedUntil = null;
        move('muted', record.reason, record.timestamp);
        break;
      }
      default:
        break;
    }
  }

  // A bounded mute ends on the clock, without needing a fresh audit line.
  if (cursor.state === 'muted' && mutedUntil !== null && Date.parse(mutedUntil) <= now.getTime()) {
    const endedAt = mutedUntil;
    mutedUntil = null;
    transitions.push({
      from: 'muted',
      to: 'active',
      reason: 'mute_window_elapsed',
      at: endedAt,
      policy_id: policy.id,
    });
    cursor.state = 'active';
    cursor.since = endedAt;
  }

  if (archive !== undefined) {
    move('archived', `archived:${archive.reason}`, archive.at);
    dismissals = 0;
    mutedUntil = null;
  }

  return {
    policy_id: policy.id,
    state: cursor.state,
    since: cursor.since,
    consecutive_dismissals: dismissals,
    muted_until: mutedUntil,
    transitions,
  };
}

/**
 * Authoring state before any runtime history: a policy that fails validation
 * can never leave `draft`.
 */
export function authoringState(valid: boolean): LifecycleState {
  return valid ? 'validated' : 'draft';
}
