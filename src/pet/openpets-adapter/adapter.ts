import {
  REACTION_COOLDOWN_MS,
  SPEECH_COOLDOWN_MS,
  isReaction,
  type Reaction,
} from './contract.js';
import { LeaseManager, type LeaseTransport } from './lease.js';
import { pickSpeech, safeSpeechOrNull } from './speech.js';
import type { Dispatch } from './map.js';

/**
 * Fire-and-forget dispatch.
 *
 * The contract is blunt: **the pet must never slow down or break the agent.**
 * So every call here is non-blocking, every failure is swallowed, and nothing
 * awaits a reply before returning. A dropped reaction is invisible; a blocked
 * agent is not.
 *
 * That makes error visibility a design problem rather than an oversight: if
 * everything is swallowed, "the pet stopped working" has no signal anywhere.
 * The answer is `stats`: counters and the last error, available for a doctor
 * command, never on the dispatch path.
 */

/** The two IPC calls the pet surface needs. */
export interface PetTransport extends LeaseTransport {
  react(reaction: Reaction, leaseId: string | null): Promise<void>;
  say(message: string, leaseId: string | null): Promise<void>;
}

export interface AdapterStats {
  dispatched: number;
  reactionsSent: number;
  speechesSent: number;
  skippedByCooldown: number;
  skippedUnsafeSpeech: number;
  failures: number;
  lastError: string | null;
  lastDispatchAt: number | null;
}

export interface OpenPetsAdapterOptions {
  transport: PetTransport;
  /** Injected clock, so cooldowns are testable. */
  now?: () => number;
  speechCooldownMs?: number;
  reactionCooldownMs?: number;
  /** Never dispatch anything. Used when the user disables the integration. */
  enabled?: boolean;
}

export interface OpenPetsAdapter {
  /** Dispatch a decision. Never throws, never blocks the caller. */
  dispatch(dispatch: Dispatch): void;
  /** Release the lease; message is the shutdown path. */
  close(): Promise<void>;
  stats(): AdapterStats;
  /** The lease manager, exposed so a doctor command can report state. */
  lease(): LeaseManager;
}

export function createOpenPetsAdapter(options: OpenPetsAdapterOptions): OpenPetsAdapter {
  const now = options.now ?? (() => Date.now());
  const speechCooldown = options.speechCooldownMs ?? SPEECH_COOLDOWN_MS;
  const reactionCooldown = options.reactionCooldownMs ?? REACTION_COOLDOWN_MS;

  let enabled = options.enabled ?? true;
  let closed = false;
  let speechOrdinal = 0;

  let lastReactionAt = Number.NEGATIVE_INFINITY;
  let lastSpeechAt = Number.NEGATIVE_INFINITY;

  const stats: AdapterStats = {
    dispatched: 0,
    reactionsSent: 0,
    speechesSent: 0,
    skippedByCooldown: 0,
    skippedUnsafeSpeech: 0,
    failures: 0,
    lastError: null,
    lastDispatchAt: null,
  };

  const lease = new LeaseManager({
    transport: options.transport,
    now,
    onHeartbeatError: (error) => {
      stats.failures += 1;
      stats.lastError = describe(error);
    },
  });

  const recordFailure = (error: unknown): void => {
    stats.failures += 1;
    stats.lastError = describe(error);
  };

  return {
    dispatch(next: Dispatch): void {
      if (!enabled || closed) return;
      if (next.reaction === null && next.speech === null) return;

      stats.dispatched += 1;
      stats.lastDispatchAt = now();
      const at = now();

      const mood = next.reaction !== null && isReaction(next.reaction) ? next.reaction : null;
      if (mood !== null && at - lastReactionAt >= reactionCooldown) {
        lastReactionAt = at;
        // No await, no catch chaining on the caller: failures land in stats.
        void (async () => {
          const leaseId = await lease.ensure();
          try {
            await options.transport.react(mood, leaseId);
            stats.reactionsSent += 1;
          } catch (error) {
            recordFailure(error);
          }
        })();
      } else if (mood !== null) {
        stats.skippedByCooldown += 1;
      }

      if (next.speech !== null && at - lastSpeechAt >= speechCooldown) {
        const message = safeSpeechOrNull(pickSpeech(next.speech, speechOrdinal));
        speechOrdinal += 1;
        if (message === null) {
          // The pool itself produced something unsafe. Say nothing.
          stats.skippedUnsafeSpeech += 1;
        } else {
          lastSpeechAt = at;
          void (async () => {
            const leaseId = await lease.ensure();
            try {
              await options.transport.say(message, leaseId);
              stats.speechesSent += 1;
            } catch (error) {
              recordFailure(error);
            }
          })();
        }
      } else if (next.speech !== null) {
        stats.skippedByCooldown += 1;
      }
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Release last, so a shutdown that races with a dispatch still tears the
      // pet down exactly once.
      await lease.release();
    },

    stats(): AdapterStats {
      return { ...stats };
    },

    lease(): LeaseManager {
      return lease;
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
