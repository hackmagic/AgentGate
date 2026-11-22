import { randomUUID } from 'node:crypto';

import type { AuditQuery, AuditRecord, AuditStore } from '../audit/store.js';
import { AgentGateError } from '../errors.js';
import type { AgentEvent } from '../events/types.js';
import { evaluateEvent, type EvaluationResult } from '../policy/evaluate.js';
import { applyResponse, emptyMuteState, isPolicyMuted, markPresented, type MuteState } from '../policy/mute.js';
import { summarizePolicy, type PolicySummary } from '../policy/summary.js';
import type { Policy } from '../policy/types.js';
import type { GateResponse, GateSignal } from '../signal/types.js';
import { systemClock, type Clock } from '../util/clock.js';
import { ENGINE_VERSION } from '../version.js';
import { append, auditStage } from './audit-stage.js';
import { inboxStage, SignalInbox } from './inbox.js';
import { runStages, stageNames } from './pipeline.js';
import { throttleStage, ThrottleState } from './throttle.js';
import {
  DEFAULT_PRESENTATION_WINDOW_MINUTES,
  type EvaluateOutcome,
  type GateCall,
  type GateOptions,
  type GateStage,
  type RespondOutcome,
} from './types.js';

/**
 * The gate: a *composition* of middleware around the pure evaluator.
 *
 * It owns no decision logic of its own. Evaluation is pure
 * (`policy/evaluate.ts`); throttling, inbox bookkeeping and auditing are
 * `GateStage` instances composed in `stages` and replaceable through
 * `GateOptions.stages`. See docs/zh-cn/02-architecture.md.
 *
 * It never executes an action — it records the decision and lets the adapter
 * (pet, CLI, MCP host) act after the user answers.
 */
export class AgentGate {
  private readonly policies: readonly Policy[];
  private readonly auditStore: AuditStore;
  private readonly clock: Clock;
  private readonly timezone: string | undefined;
  private readonly engineVersion: string;
  private readonly muteThreshold: number;
  private readonly presentationWindowMinutes: number;
  private readonly signalIdFactory: () => string;

  private readonly throttle = new ThrottleState();
  private readonly inbox = new SignalInbox();
  private readonly stages: readonly GateStage[];

  private muteState: MuteState = emptyMuteState();

  constructor(options: GateOptions) {
    this.policies = [...options.policies];
    this.auditStore = options.audit;
    this.clock = options.clock ?? systemClock;
    this.timezone = options.timezone;
    this.engineVersion = options.engine_version ?? ENGINE_VERSION;
    this.muteThreshold = options.mute_threshold ?? 3;
    this.presentationWindowMinutes = options.presentation_window_minutes ?? DEFAULT_PRESENTATION_WINDOW_MINUTES;
    this.signalIdFactory = options.signal_id_factory ?? randomUUID;

    // `options.stages` replaces the default chain outright; extra middleware
    // composes by spreading the exported stage factories.
    this.stages = options.stages ?? [
      throttleStage(this.throttle, { presentation_window_minutes: this.presentationWindowMinutes }),
      inboxStage(this.inbox),
      auditStage({ store: this.auditStore, engine_version: this.engineVersion }),
    ];
  }

  get policyCount(): number {
    return this.policies.length;
  }

  get engineVersionNumber(): string {
    return this.engineVersion;
  }

  /** Stage names in execution order — the pipeline is inspectable, not implicit. */
  get pipeline(): string[] {
    return stageNames(this.stages);
  }

  listPolicies(): PolicySummary[] {
    return [...this.policies].map(summarizePolicy);
  }

  /**
   * Evaluate one event. `now` lets a caller replay history deterministically
   * (the pet bridge feeds it from `X-Agent-Gate-Now`); by default the injected
   * clock decides.
   */
  evaluate(event: AgentEvent, now: Date = this.clock.now()): EvaluateOutcome {
    this.inbox.pruneExpired(now);

    const call: GateCall = {
      event,
      now,
      policies: this.policies,
      timezone: this.timezone,
      mute_state: this.muteState,
      engine_version: this.engineVersion,
      signal_id_factory: this.signalIdFactory,
      result: null,
      matched_policy: null,
      throttled: false,
      presented: false,
    };

    runStages(this.stages, call, (current) => this.evaluateStage(current));

    // Side effects that belong to the gate itself, not to a replaceable stage.
    const result = call.result as EvaluationResult;
    if (call.presented && result.signal !== null) {
      const policy = call.matched_policy;
      if (policy !== null) this.throttle.markPresented(policy.id, now);
      this.muteState = markPresented(this.muteState, result.signal.policy_id, now);
    }

    return { ...result, throttled: call.throttled };
  }

  respond(response: GateResponse): RespondOutcome {
    const now = this.clock.now();
    this.inbox.pruneExpired(now);

    // Look before taking: an invalid action is a caller bug, and must not
    // destroy a signal the user still has on screen.
    const signal = this.inbox.peek(response.signal_id);
    if (signal === undefined) {
      throw new AgentGateError(
        'unknown_signal',
        `signal "${response.signal_id}" is unknown, expired or already answered`,
      );
    }

    const known = signal.presentation.actions.some((action) => action.action_id === response.action_id);
    if (!known) {
      throw new AgentGateError(
        'invalid_action',
        `signal "${response.signal_id}" does not offer action "${response.action_id}"`,
      );
    }

    this.inbox.take(response.signal_id);

    const applied = applyResponse(
      this.muteState,
      { policy_id: signal.policy_id, action_id: response.action_id, responded_at: response.responded_at },
      this.muteThreshold,
    );
    this.muteState = applied.state;

    const reason =
      response.action_id === 'approve'
        ? 'user_approved'
        : response.action_id === 'dismiss'
          ? 'user_dismissed'
          : 'user_muted';

    append(
      { store: this.auditStore, engine_version: this.engineVersion },
      {
        event_id: signal.trigger_event_id,
        policy_id: signal.policy_id,
        decision: signal.decision,
        signal_id: signal.id,
        reason,
        degraded: false,
        now,
        user_response: response.action_id,
      },
    );

    // Crossing the dismissal threshold is its own transition, and it needs its
    // own audit line. The `muted` reason existed in AUDIT_REASONS and in the
    // lifecycle projection, but nothing ever wrote it — so the projection could
    // only ever see `user_dismissed` and reported a muted policy as `active`.
    // The projection is only as honest as the log it folds.
    if (applied.muted_now) {
      append(
        { store: this.auditStore, engine_version: this.engineVersion },
        {
          event_id: signal.trigger_event_id,
          policy_id: signal.policy_id,
          decision: signal.decision,
          signal_id: signal.id,
          reason: 'muted',
          degraded: false,
          now,
          user_response: response.action_id,
        },
      );
    }

    return {
      signal,
      muted_now: applied.muted_now,
      policy_muted: isPolicyMuted(this.muteState, signal.policy_id, now),
    };
  }

  /** Signals still waiting for a user response, expired ones pruned. */
  pending(): GateSignal[] {
    return this.inbox.list(this.clock.now());
  }

  muteStateSnapshot(): MuteState {
    return structuredClone(this.muteState);
  }

  queryAudit(query: AuditQuery = {}): AuditRecord[] {
    return this.auditStore.query(query);
  }

  /** The pure evaluation, wrapped so the pipeline owns the call object. */
  private evaluateStage(call: GateCall): void {
    const result = evaluateEvent(call.policies, call.event, {
      now: call.now,
      timezone: call.timezone,
      mute_state: call.mute_state,
      signal_id_factory: call.signal_id_factory,
    });

    call.result = result;
    call.matched_policy =
      result.matched_policy_id === null
        ? null
        : (call.policies.find((policy) => policy.id === result.matched_policy_id) ?? null);
  }
}

export { DEFAULT_PRESENTATION_WINDOW_MINUTES };
export type { EvaluateOutcome, GateCall, GateOptions, GateStage, RespondOutcome };
