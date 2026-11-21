import type { ActionId } from './types.js';

export const DEFAULT_MUTE_THRESHOLD = 3;
export const MUTE_WINDOW_MINUTES = 60;

export interface PolicyMuteState {
  consecutive_dismissals: number;
  muted: boolean;
  muted_at: string | null;
  muted_until: string | null;
  last_presented_at: string | null;
  dismissed_at: string | null;
}

export interface MuteState {
  policies: Record<string, PolicyMuteState>;
}

export interface ResponseEvent {
  policy_id: string;
  action_id: ActionId;
  responded_at: string;
}

export interface ApplyResponseResult {
  state: MuteState;
  muted_now: boolean;
}

export function emptyMuteState(): MuteState {
  return { policies: {} };
}

export function getPolicyMuteState(state: MuteState, policyId: string): PolicyMuteState {
  return (
    state.policies[policyId] ?? {
      consecutive_dismissals: 0,
      muted: false,
      muted_at: null,
      muted_until: null,
      last_presented_at: null,
      dismissed_at: null,
    }
  );
}

export function isPolicyMuted(state: MuteState, policyId: string, now: Date): boolean {
  const entry = state.policies[policyId];
  if (entry === undefined) return false;
  if (entry.muted) return true;
  if (entry.muted_until === null) return false;
  return Date.parse(entry.muted_until) > now.getTime();
}

/** Record that a signal was surfaced; returns a new immutable state. */
export function markPresented(state: MuteState, policyId: string, at: Date): MuteState {
  const next = cloneState(state);
  next.policies[policyId] = { ...getPolicyMuteState(state, policyId), last_presented_at: at.toISOString() };
  return next;
}

/**
 * Fold a user's response into mute state. Three consecutive dismissals mute
 * the policy and ask the user to revise it (docs/04, rule 5).
 */
export function applyResponse(
  state: MuteState,
  event: ResponseEvent,
  threshold: number = DEFAULT_MUTE_THRESHOLD,
): ApplyResponseResult {
  if (threshold < 1) throw new RangeError('mute threshold must be >= 1');
  const next = cloneState(state);
  const current = getPolicyMuteState(state, event.policy_id);
  const respondedAt = new Date(event.responded_at);

  if (event.action_id === 'approve') {
    next.policies[event.policy_id] = {
      ...current,
      consecutive_dismissals: 0,
      muted: false,
      muted_at: null,
      muted_until: null,
    };
    return { state: next, muted_now: false };
  }

  if (event.action_id === 'mute_1h') {
    next.policies[event.policy_id] = {
      ...current,
      muted: false,
      muted_until: new Date(respondedAt.getTime() + MUTE_WINDOW_MINUTES * 60_000).toISOString(),
      dismissed_at: event.responded_at,
    };
    return { state: next, muted_now: false };
  }

  const consecutive = current.consecutive_dismissals + 1;
  const mutedNow = consecutive >= threshold;
  next.policies[event.policy_id] = {
    ...current,
    consecutive_dismissals: consecutive,
    muted: mutedNow || current.muted,
    muted_at: mutedNow ? event.responded_at : current.muted_at,
    dismissed_at: event.responded_at,
  };
  return { state: next, muted_now: mutedNow };
}

/** Explicit user/operator unmute; keeps the dismissal history. */
export function unmutePolicy(state: MuteState, policyId: string): MuteState {
  const next = cloneState(state);
  next.policies[policyId] = {
    ...getPolicyMuteState(state, policyId),
    consecutive_dismissals: 0,
    muted: false,
    muted_at: null,
    muted_until: null,
  };
  return next;
}

function cloneState(state: MuteState): MuteState {
  return structuredClone(state);
}
