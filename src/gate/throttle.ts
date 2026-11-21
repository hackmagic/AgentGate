import type { Policy } from '../policy/types.js';
import type { GateCall, GateStage } from './types.js';

export interface ThrottleOptions {
  /** Default window when a policy declares no `escalation.after_minutes`. */
  presentation_window_minutes: number;
}

/** Per-policy "last presented at" timestamps; owned by the throttle stage. */
export class ThrottleState {
  private readonly lastPresented = new Map<string, number>();

  lastPresentedAt(policyId: string): number | undefined {
    return this.lastPresented.get(policyId);
  }

  markPresented(policyId: string, at: Date): void {
    this.lastPresented.set(policyId, at.getTime());
  }

  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.lastPresented);
  }

  clear(): void {
    this.lastPresented.clear();
  }
}

/**
 * Rate limiter as a middleware, not as engine glue.
 *
 * A match inside its presentation window is downgraded to `allow` and audited
 * as `rate_limited` — textually visible in `result.traces`, so "why did I not
 * get a bubble?" has an answer that is not a debugger session.
 */
export function throttleStage(state: ThrottleState, options: ThrottleOptions): GateStage {
  return {
    name: 'throttle',
    after(call: GateCall): void {
      const result = call.result;
      const policy = call.matched_policy;
      if (result === null || result.signal === null || policy === null) return;
      if (!isThrottled(state, policy, call.now, options.presentation_window_minutes)) return;

      call.throttled = true;
      call.result = { ...result, decision: 'allow', signal: null };
    },
  };
}

export function isThrottled(
  state: ThrottleState,
  policy: Policy,
  now: Date,
  presentationWindowMinutes: number,
): boolean {
  const previous = state.lastPresentedAt(policy.id);
  if (previous === undefined) return false;
  const windowMinutes = policy.escalation?.after_minutes ?? presentationWindowMinutes;
  return now.getTime() - previous < windowMinutes * 60_000;
}
