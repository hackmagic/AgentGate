import type { GateSignal } from '../signal/types.js';
import type { GateCall, GateStage } from './types.js';

export interface PendingSignal {
  signal: GateSignal;
  presented_at_ms: number;
}

/**
 * The in-flight signal inbox: signals handed to an embodiment layer that have
 * not been answered or expired yet.
 *
 * Kept separate from the gate so it can be inspected, replayed or persisted by
 * whoever owns the process — the gate only needs `accept`, `take`, `peek`.
 */
export class SignalInbox {
  private readonly signals = new Map<string, PendingSignal>();

  accept(signal: GateSignal, at: Date): void {
    this.signals.set(signal.id, { signal, presented_at_ms: at.getTime() });
  }

  /** Remove and return a signal; `undefined` if unknown, expired or answered. */
  take(signalId: string): GateSignal | undefined {
    const entry = this.signals.get(signalId);
    if (entry === undefined) return undefined;
    this.signals.delete(signalId);
    return entry.signal;
  }

  peek(signalId: string): GateSignal | undefined {
    return this.signals.get(signalId)?.signal;
  }

  /** Every unexpired signal, oldest first. */
  list(now: Date): GateSignal[] {
    this.pruneExpired(now);
    return [...this.signals.values()].map((entry) => entry.signal);
  }

  /** Drop signals whose `expires_at` has passed. Idempotent. */
  pruneExpired(now: Date): void {
    for (const [id, entry] of this.signals) {
      const expiresAt = entry.signal.expires_at;
      if (expiresAt !== null && Date.parse(expiresAt) <= now.getTime()) {
        this.signals.delete(id);
      }
    }
  }

  get size(): number {
    return this.signals.size;
  }
}

/** Accepts any surviving signal into the inbox once throttling has passed. */
export function inboxStage(inbox: SignalInbox): GateStage {
  return {
    name: 'inbox',
    after(call: GateCall): void {
      const result = call.result;
      if (result === null || result.signal === null || call.throttled) return;
      inbox.accept(result.signal, call.now);
      call.presented = true;
    },
  };
}
