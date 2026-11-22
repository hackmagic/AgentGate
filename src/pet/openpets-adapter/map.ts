import type { GateSignal } from '../../signal/types.js';
import type { AgentEvent } from '../../events/types.js';
import type { Reaction, SpeechCategory } from './contract.js';

/**
 * How an AgentGate decision becomes an OpenPets reaction.
 *
 * This is the adapter's whole opinion, and it is deliberately narrow. The
 * engine decided *whether* to intervene; OpenPets decides *how it looks*. The
 * adapter only translates, and it must not upgrade a decision while doing so —
 * a `suggest` may never arrive at the pet looking like an approval demand.
 */

/** What to dispatch for one evaluation, if anything. */
export interface Dispatch {
  reaction: Reaction | null;
  speech: SpeechCategory | null;
}

/**
 * Note on `presentation.animation_hint`: this adapter deliberately does not
 * consume it, and that is a contract position, not an oversight.
 *
 * OpenPets takes a *closed reaction enum* and maps reactions to sprite
 * animations inside the app, where the user can override the mapping. The
 * published contract defines no hint→reaction translation, so inventing one
 * ("stretch" → what? "idle_shift" → what?) would fight the host's ownership of
 * appearance and produce reactions the app is free to re-map anyway.
 *
 * The hint is therefore honoured by embodiments that own their own presentation
 * (the DSH composer row shows a static marker keyed by it) and ignored here —
 * stated in the README rather than dropped silently.
 */

/**
 * A signal is present: the engine wants the user's attention.
 *
 * `require_approval` waits (a decision is blocked on the user); `suggest` and
 * `suppress` are informational, so they take the softer attention reaction.
 */
export function dispatchForSignal(signal: GateSignal): Dispatch {
  switch (signal.decision) {
    case 'require_approval':
      return { reaction: 'waiting', speech: 'permission' };
    case 'suggest':
    case 'suppress':
      return { reaction: 'thinking', speech: 'question' };
    default:
      // The signal decision type is closed, but a future value must not crash
      // an adapter; showing attention with no claim is the safe fallback.
      return { reaction: 'waiting', speech: null };
  }
}

/**
 * No signal was produced. Only two cases are worth a reaction, and both are
 * about *engine health* rather than user-facing guidance:
 *
 * - a degraded evaluation means a policy threw, which a maintainer wants to see;
 * - a throttled match means the engine deliberately stayed quiet.
 *
 * A plain `allow` is the overwhelmingly common outcome and must produce
 * nothing at all. Reacting to it would make the pet animate on every idle tick.
 */
export function dispatchForEmpty(meta: { degraded: boolean; throttled: boolean }): Dispatch {
  if (meta.degraded) return { reaction: 'error', speech: 'error' };
  return { reaction: null, speech: null };
}

/**
 * Map an AgentGate event type to the reaction an agent host would already be
 * showing, so the pet reads as "the agent is doing this thing" rather than
 * "a policy fired".
 *
 * Used only when the adapter is mounted as a *runtime* observer (see
 * `runtimeForEvent`); a signal always wins over this.
 */
export function runtimeForEvent(event: AgentEvent): Dispatch {
  switch (event.type) {
    case 'focus_block_started':
      return { reaction: 'working', speech: null };
    case 'focus_block_ended':
      return { reaction: 'success', speech: 'success' };
    case 'app_switch':
      return { reaction: 'thinking', speech: null };
    case 'idle_detected':
      return { reaction: 'waiting', speech: null };
    case 'interruption':
      return { reaction: 'error', speech: null };
    case 'notification_received':
      return { reaction: 'working', speech: null };
    default:
      return { reaction: null, speech: null };
  }
}

/** Combine: a signal outranks an event-derived reaction, and never merges with it. */
export function resolveDispatch(
  signal: GateSignal | null,
  meta: { degraded: boolean; throttled: boolean; event?: AgentEvent },
): Dispatch {
  if (signal !== null) return dispatchForSignal(signal);
  const empty = dispatchForEmpty(meta);
  if (empty.reaction !== null) return empty;
  return meta.event === undefined ? { reaction: null, speech: null } : runtimeForEvent(meta.event);
}
