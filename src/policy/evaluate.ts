import { randomUUID } from 'node:crypto';

import { errorMessage } from '../errors.js';
import type { AgentEvent } from '../events/types.js';
import { buildSignal } from '../signal/build.js';
import type { GateSignal } from '../signal/types.js';
import { assertSignalInvariants } from '../signal/validate.js';
import { evaluateConditions } from './conditions.js';
import { emptyMuteState, isPolicyMuted, type MuteState } from './mute.js';
import {
  comparePolicyPriority,
  type Policy,
  type PolicyDecision,
  type SignalDecision,
  type TriggerContextMatcher,
} from './types.js';

export type TraceStatus = 'matched' | 'skipped' | 'muted' | 'error';

export interface PolicyTrace {
  policy_id: string;
  status: TraceStatus;
  /** Machine-readable reason, safe to log. */
  reason: string;
  decision: PolicyDecision | null;
}

export interface EvaluationResult {
  event_id: string;
  decision: PolicyDecision;
  signal: GateSignal | null;
  matched_policy_id: string | null;
  /** True when at least one policy failed to evaluate and the engine fell back to allow. */
  degraded: boolean;
  traces: PolicyTrace[];
  warnings: string[];
}

export interface EvaluateOptions {
  now?: Date;
  /** IANA zone used by `time_window` / `day_of_week`; defaults to the host zone. */
  timezone?: string;
  mute_state?: MuteState;
  signal_id_factory?: () => string;
}

export function resolveDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Pure policy evaluation. No I/O, no clock access beyond `options.now`, no
 * system side effects — the engine decides, an adapter acts.
 */
export function evaluateEvent(
  policies: readonly Policy[],
  event: AgentEvent,
  options: EvaluateOptions = {},
): EvaluationResult {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? resolveDefaultTimezone();
  const muteState = options.mute_state ?? emptyMuteState();
  const idFactory = options.signal_id_factory ?? randomUUID;

  const traces: PolicyTrace[] = [];
  const warnings: string[] = [];
  let degraded = false;

  for (const policy of [...policies].sort(comparePolicyPriority)) {
    if (isPolicyMuted(muteState, policy.id, now)) {
      traces.push({ policy_id: policy.id, status: 'muted', reason: 'muted', decision: null });
      continue;
    }

    if (policy.trigger.event !== event.type) {
      traces.push({ policy_id: policy.id, status: 'skipped', reason: 'event_mismatch', decision: null });
      continue;
    }

    if (!matchesTriggerContext(policy.trigger.context, event)) {
      traces.push({ policy_id: policy.id, status: 'skipped', reason: 'context_mismatch', decision: null });
      continue;
    }

    let matched: boolean;
    try {
      const conditionResult = evaluateConditions(policy.conditions, { event, now, timezone });
      matched = conditionResult.matched;
      warnings.push(...conditionResult.warnings.map((warning) => `${policy.id}: ${warning}`));
    } catch (error) {
      // Rule 4: a broken policy must never block the user; degrade to allow.
      degraded = true;
      warnings.push(`${policy.id}: ${errorMessage(error)}`);
      traces.push({ policy_id: policy.id, status: 'error', reason: 'evaluation_error', decision: null });
      continue;
    }

    if (!matched) {
      traces.push({ policy_id: policy.id, status: 'skipped', reason: 'conditions_not_met', decision: null });
      continue;
    }

    const decision = resolveDecision(policy);
    traces.push({ policy_id: policy.id, status: 'matched', reason: 'trigger_matched', decision });

    if (decision === 'allow') continue;

    const signal = buildSignal(policy, event, decision, { now, id: idFactory() });
    assertSignalInvariants(signal);

    return {
      event_id: event.id,
      decision,
      signal,
      matched_policy_id: policy.id,
      degraded,
      traces,
      warnings,
    };
  }

  return {
    event_id: event.id,
    decision: 'allow',
    signal: null,
    matched_policy_id: null,
    degraded,
    traces,
    warnings,
  };
}

/**
 * Rule 1: `suppress` plus `requires_approval: true` may only *ask*; the
 * engine downgrades it to an approval request instead of executing.
 */
export function resolveDecision(policy: Policy): PolicyDecision {
  if (policy.decision === 'suppress' && policy.safety.requires_approval) return 'require_approval';
  return policy.decision;
}

export function matchesTriggerContext(matcher: TriggerContextMatcher | undefined, event: AgentEvent): boolean {
  if (matcher === undefined) return true;
  return (
    matchesFacet(matcher.app, event.context.app) &&
    matchesFacet(matcher.project, event.context.project) &&
    matchesFacet(matcher.language, event.context.language)
  );
}

function matchesFacet(expected: string[] | undefined, actual: string | null): boolean {
  if (expected === undefined) return true;
  if (actual === null) return false;
  const lowered = actual.toLowerCase();
  return expected.some((candidate) => candidate.toLowerCase() === lowered);
}
