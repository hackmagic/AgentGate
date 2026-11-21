import type { AuditQuery, AuditRecord, AuditStore } from '../audit/store.js';
import type { AgentEvent } from '../events/types.js';
import type { EvaluationResult } from '../policy/evaluate.js';
import type { MuteState } from '../policy/mute.js';
import type { Policy } from '../policy/types.js';
import type { GateSignal } from '../signal/types.js';
import type { Clock } from '../util/clock.js';

/** A policy may be presented at most once per this window unless it says otherwise. */
export const DEFAULT_PRESENTATION_WINDOW_MINUTES = 30;

/**
 * One evaluation in flight. The pure evaluator fills `result`; middleware
 * stages then post-process it in registration order before the audit stage
 * observes the final state.
 */
export interface GateCall {
  readonly event: AgentEvent;
  readonly now: Date;
  readonly policies: readonly Policy[];
  readonly timezone: string | undefined;
  readonly mute_state: MuteState;
  readonly engine_version: string;
  readonly signal_id_factory: () => string;

  /** Filled by the evaluation stage; never null after the pipeline runs. */
  result: EvaluationResult | null;
  /** The policy behind `result.matched_policy_id`, resolved once. */
  matched_policy: Policy | null;
  /** Set by the throttle stage: a match was downgraded to `allow`. */
  throttled: boolean;
  /** Set by the inbox stage: the signal is now awaiting a user response. */
  presented: boolean;
}

/**
 * A replaceable step in the evaluation pipeline. `before` runs before the pure
 * evaluator, `after` runs after it — both in registration order, so the order
 * you compose is the order you get.
 *
 * Stages are the seam that used to be welded into `AgentGate.evaluate()`:
 * throttling, inbox bookkeeping and auditing are each independently
 * constructible, replaceable and testable.
 */
export interface GateStage {
  readonly name: string;
  before?(call: GateCall): void;
  after?(call: GateCall): void;
}

export interface GateOptions {
  policies: readonly Policy[];
  audit: AuditStore;
  clock?: Clock;
  timezone?: string;
  engine_version?: string;
  mute_threshold?: number;
  presentation_window_minutes?: number;
  signal_id_factory?: () => string;
  /**
   * Replace the default middleware chain entirely. Omit to get
   * `throttle → inbox → audit`. Supply your own to compose a different gate —
   * e.g. no throttling for a replay harness, or a metrics stage on the end.
   */
  stages?: readonly GateStage[];
}

export interface EvaluateOutcome extends EvaluationResult {
  /** True when a policy matched but the presentation window suppressed it. */
  throttled: boolean;
}

export interface RespondOutcome {
  signal: GateSignal;
  muted_now: boolean;
  policy_muted: boolean;
}

export interface AuditSink {
  append(record: AuditRecord): void;
  query(query?: AuditQuery): AuditRecord[];
}
