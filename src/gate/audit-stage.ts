import { createAuditRecord, type AuditQuery, type AuditRecord, type AuditStore } from '../audit/store.js';
import type { GateCall, GateStage } from './types.js';

export interface AuditStageOptions {
  store: AuditStore;
  engine_version: string;
}

const DECISION_OF_REASON = {
  rate_limited: 'allow',
} as const satisfies Record<string, AuditRecord['decision']>;

/**
 * Audit sink as a middleware. It observes the *final* call state, so a
 * throttled match is recorded as `rate_limited` and a degraded run as
 * `degraded` — no second code path can forget to write a line.
 */
export function auditStage(options: AuditStageOptions): GateStage {
  return {
    name: 'audit',
    after(call: GateCall): void {
      const result = call.result;
      if (result === null) return;

      if (call.throttled) {
        append(options, {
          event_id: call.event.id,
          policy_id: result.matched_policy_id,
          decision: DECISION_OF_REASON['rate_limited'],
          signal_id: null,
          reason: 'rate_limited',
          degraded: result.degraded,
          now: call.now,
        });
        return;
      }

      if (result.signal === null) {
        // Nothing surfaced: only an error fallback is worth a line. A plain
        // `allow` is the overwhelmingly common case and would drown the trail.
        if (result.degraded) {
          append(options, {
            event_id: call.event.id,
            policy_id: null,
            decision: 'allow',
            signal_id: null,
            reason: 'degraded',
            degraded: true,
            now: call.now,
          });
        }
        return;
      }

      append(options, {
        event_id: call.event.id,
        policy_id: result.matched_policy_id,
        decision: result.decision,
        signal_id: result.signal.id,
        reason: result.degraded ? 'degraded' : 'matched',
        degraded: result.degraded,
        now: call.now,
      });
    },
  };
}

export interface AppendInput {
  event_id: string;
  policy_id: string | null;
  decision: AuditRecord['decision'];
  signal_id: string | null;
  reason: AuditRecord['reason'];
  degraded: boolean;
  now: Date;
  user_response?: string | null;
}

/** Single writer for audit records; keeps the whitelist funnel in one place. */
export function append(options: AuditStageOptions, input: AppendInput): AuditRecord {
  const record = createAuditRecord({
    event_id: input.event_id,
    policy_id: input.policy_id ?? 'none',
    decision: input.decision,
    signal_id: input.signal_id,
    user_response: input.user_response ?? null,
    timestamp: input.now.toISOString(),
    engine_version: options.engine_version,
    degraded: input.degraded,
    reason: input.reason,
  });
  options.store.append(record);
  return record;
}

export function queryAudit(store: AuditStore, query: AuditQuery = {}): AuditRecord[] {
  return store.query(query);
}
