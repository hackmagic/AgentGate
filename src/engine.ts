import { randomUUID } from 'node:crypto';

import { createAuditRecord, type AuditQuery, type AuditRecord, type AuditStore } from './audit/store.js';
import { GuidanceError } from './errors.js';
import type { GuidanceEvent } from './events/types.js';
import { evaluateEvent, type EvaluationResult } from './policy/evaluate.js';
import { applyResponse, emptyMuteState, isPolicyMuted, markPresented, type MuteState } from './policy/mute.js';
import { summarizePolicy, type PolicySummary } from './policy/summary.js';
import type { Policy } from './policy/types.js';
import type { GuidanceResponse, GuidanceSignal } from './signal/types.js';
import { systemClock, type Clock } from './util/clock.js';
import { ENGINE_VERSION } from './version.js';

/** A policy may be presented at most once per this window unless it says otherwise. */
export const DEFAULT_PRESENTATION_WINDOW_MINUTES = 30;

export interface EngineOptions {
  policies: readonly Policy[];
  audit: AuditStore;
  clock?: Clock;
  timezone?: string;
  engine_version?: string;
  mute_threshold?: number;
  presentation_window_minutes?: number;
  signal_id_factory?: () => string;
}

export interface EvaluateOutcome extends EvaluationResult {
  /** True when a policy matched but the presentation window suppressed it. */
  throttled: boolean;
}

export interface RespondOutcome {
  signal: GuidanceSignal;
  muted_now: boolean;
  policy_muted: boolean;
}

interface PendingSignal {
  signal: GuidanceSignal;
  presented_at_ms: number;
}

/**
 * Stateful façade over the pure policy engine: owns mute state, in-flight
 * signals and the audit trail. It never executes an action — it records the
 * decision and lets the adapter (pet, CLI, MCP host) act.
 */
export class GuidanceEngine {
  private readonly policies: readonly Policy[];
  private readonly auditStore: AuditStore;
  private readonly clock: Clock;
  private readonly timezone: string | undefined;
  private readonly engineVersion: string;
  private readonly muteThreshold: number;
  private readonly presentationWindowMinutes: number;
  private readonly signalIdFactory: () => string;

  private muteState: MuteState = emptyMuteState();
  private readonly pendingSignals = new Map<string, PendingSignal>();
  private readonly lastPresented = new Map<string, number>();

  constructor(options: EngineOptions) {
    this.policies = [...options.policies];
    this.auditStore = options.audit;
    this.clock = options.clock ?? systemClock;
    this.timezone = options.timezone;
    this.engineVersion = options.engine_version ?? ENGINE_VERSION;
    this.muteThreshold = options.mute_threshold ?? 3;
    this.presentationWindowMinutes = options.presentation_window_minutes ?? DEFAULT_PRESENTATION_WINDOW_MINUTES;
    this.signalIdFactory = options.signal_id_factory ?? randomUUID;
  }

  get policyCount(): number {
    return this.policies.length;
  }

  get engineVersionNumber(): string {
    return this.engineVersion;
  }

  listPolicies(): PolicySummary[] {
    return [...this.policies].map(summarizePolicy);
  }

  /**
   * Evaluate one event. `now` lets a caller replay history deterministically
   * (the pet bridge feeds it from `X-Guidance-Now`); by default the injected
   * clock decides.
   */
  evaluate(event: GuidanceEvent, now: Date = this.clock.now()): EvaluateOutcome {
    this.pruneExpired(now);

    const result = evaluateEvent(this.policies, event, {
      now,
      timezone: this.timezone,
      mute_state: this.muteState,
      signal_id_factory: this.signalIdFactory,
    });

    if (result.signal === null) {
      if (result.degraded) this.record(event.id, 'allow', null, 'degraded', null, true, now);
      return { ...result, throttled: false };
    }

    const policy = this.policies.find((candidate) => candidate.id === result.matched_policy_id);
    if (policy !== undefined && this.isThrottled(policy, now)) {
      this.record(event.id, result.decision, null, 'rate_limited', result.matched_policy_id, result.degraded, now);
      return { ...result, decision: 'allow', signal: null, throttled: true };
    }

    this.pendingSignals.set(result.signal.id, { signal: result.signal, presented_at_ms: now.getTime() });
    if (policy !== undefined) this.lastPresented.set(policy.id, now.getTime());
    this.muteState = markPresented(this.muteState, result.signal.policy_id, now);

    this.record(
      event.id,
      result.decision,
      result.signal.id,
      result.degraded ? 'degraded' : 'matched',
      result.matched_policy_id,
      result.degraded,
      now,
    );

    return { ...result, throttled: false };
  }

  respond(response: GuidanceResponse): RespondOutcome {
    const pending = this.pendingSignals.get(response.signal_id);
    if (pending === undefined) {
      throw new GuidanceError('unknown_signal', `signal "${response.signal_id}" is unknown, expired or already answered`);
    }

    const known = pending.signal.presentation.actions.some((action) => action.action_id === response.action_id);
    if (!known) {
      throw new GuidanceError(
        'invalid_action',
        `signal "${response.signal_id}" does not offer action "${response.action_id}"`,
      );
    }

    const now = this.clock.now();
    const applied = applyResponse(
      this.muteState,
      { policy_id: pending.signal.policy_id, action_id: response.action_id, responded_at: response.responded_at },
      this.muteThreshold,
    );
    this.muteState = applied.state;
    this.pendingSignals.delete(response.signal_id);

    const reason =
      response.action_id === 'approve'
        ? 'user_approved'
        : response.action_id === 'dismiss'
          ? 'user_dismissed'
          : 'user_muted';

    this.record(
      pending.signal.trigger_event_id,
      pending.signal.decision,
      pending.signal.id,
      reason,
      pending.signal.policy_id,
      false,
      now,
      response.action_id,
    );

    return {
      signal: pending.signal,
      muted_now: applied.muted_now,
      policy_muted: isPolicyMuted(this.muteState, pending.signal.policy_id, now),
    };
  }

  /** Signals still waiting for a user response, expired ones pruned. */
  pending(): GuidanceSignal[] {
    this.pruneExpired(this.clock.now());
    return [...this.pendingSignals.values()].map((entry) => entry.signal);
  }

  muteStateSnapshot(): MuteState {
    return structuredClone(this.muteState);
  }

  queryAudit(query: AuditQuery = {}): AuditRecord[] {
    return this.auditStore.query(query);
  }

  private isThrottled(policy: Policy, now: Date): boolean {
    const previous = this.lastPresented.get(policy.id);
    if (previous === undefined) return false;
    const windowMinutes = policy.escalation?.after_minutes ?? this.presentationWindowMinutes;
    return now.getTime() - previous < windowMinutes * 60_000;
  }

  private pruneExpired(now: Date): void {
    for (const [id, entry] of this.pendingSignals) {
      const expiresAt = entry.signal.expires_at;
      if (expiresAt !== null && Date.parse(expiresAt) <= now.getTime()) {
        this.pendingSignals.delete(id);
      }
    }
  }

  private record(
    eventId: string,
    decision: PolicyDecisionLike,
    signalId: string | null,
    reason: AuditRecordReason,
    policyId: string | null,
    degraded: boolean,
    now: Date,
    userResponse: string | null = null,
  ): void {
    const record = createAuditRecord({
      event_id: eventId,
      policy_id: policyId ?? 'none',
      decision,
      signal_id: signalId,
      user_response: userResponse,
      timestamp: now.toISOString(),
      engine_version: this.engineVersion,
      degraded,
      reason,
    });
    this.auditStore.append(record);
  }
}

type PolicyDecisionLike = AuditRecord['decision'];
type AuditRecordReason = AuditRecord['reason'];
