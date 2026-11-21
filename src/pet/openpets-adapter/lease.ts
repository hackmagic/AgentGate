import {
  LEASE_HEARTBEAT_BUFFER_MS,
  LEASE_HEARTBEAT_MS,
  LEASE_TTL_MS,
} from './contract.js';

/**
 * Lease bookkeeping, separated from IPC so it can be tested without a socket.
 *
 * The lease is how several agents share a desktop pet without fighting over one
 * window: acquire on first activity, heartbeat, release on shutdown. Three
 * details in the reference documentation are the ones that actually bite, and
 * this class exists mostly to get them right once:
 *
 * 1. **Never lose the id on a failed heartbeat.** If a heartbeat fails, stash
 *    the stale id and retry the heartbeat before considering a fresh acquire.
 *    If you simply acquire again, an explicit agent pet silently re-routes onto
 *    the default pet — the user's pet moves, for no reason they can see.
 * 2. **Acquiring is idempotent per client.** Re-acquiring while a lease is live
 *    refreshes it rather than resolving a new target.
 * 3. **Release exactly once.** Shutdown can be triggered from several places
 *    (signal, transport close, unload); running the release path twice must not
 *    send a second release for an id that is already gone.
 */

export type LeaseState = 'idle' | 'acquiring' | 'held' | 'releasing' | 'closed';

/** The transport calls the adapter uses; injected so tests need no socket. */
export interface LeaseTransport {
  acquire(): Promise<string>;
  heartbeat(leaseId: string): Promise<void>;
  release(leaseId: string): Promise<void>;
}

export interface LeaseManagerOptions {
  transport: LeaseTransport;
  /** Injected so tests can drive time without sleeping. */
  now?: () => number;
  heartbeatMs?: number;
  ttlMs?: number;
  bufferMs?: number;
  /** Called when a heartbeat fails; the manager keeps the lease and retries. */
  onHeartbeatError?: (error: unknown) => void;
}

export interface LeaseSnapshot {
  state: LeaseState;
  leaseId: string | null;
  /** A heartbeat failed and the id is being preserved for a retry. */
  staleLeaseId: string | null;
  lastHeartbeatAt: number | null;
  heartbeatFailures: number;
  /** True once `release()` has completed; further calls are no-ops. */
  released: boolean;
}

export class LeaseManager {
  private state: LeaseState = 'idle';
  private leaseId: string | null = null;
  private staleLeaseId: string | null = null;
  private lastHeartbeatAt: number | null = null;
  private heartbeatFailures = 0;
  private released = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<string | null> | null = null;

  private readonly transport: LeaseTransport;
  private readonly now: () => number;
  private readonly heartbeatMs: number;
  private readonly ttlMs: number;
  private readonly bufferMs: number;
  private readonly onHeartbeatError: ((error: unknown) => void) | undefined;

  constructor(options: LeaseManagerOptions) {
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    this.heartbeatMs = options.heartbeatMs ?? LEASE_HEARTBEAT_MS;
    this.ttlMs = options.ttlMs ?? LEASE_TTL_MS;
    this.bufferMs = options.bufferMs ?? LEASE_HEARTBEAT_BUFFER_MS;
    this.onHeartbeatError = options.onHeartbeatError;

    if (this.heartbeatMs >= this.ttlMs - this.bufferMs) {
      throw new RangeError(
        `heartbeat ${this.heartbeatMs}ms leaves no room inside a ${this.ttlMs}ms TTL with a ${this.bufferMs}ms buffer`,
      );
    }
  }

  /**
   * Ensure a live lease, acquiring only when necessary.
   *
   * Concurrent callers share one acquisition: two agent events arriving in the
   * same tick must not create two leases and therefore two pets.
   */
  async ensure(): Promise<string | null> {
    if (this.released) return null;
    if (this.state === 'held' && this.leaseId !== null) return this.leaseId;
    if (this.inFlight !== null) return this.inFlight;

    this.state = 'acquiring';
    this.inFlight = (async () => {
      try {
        // Recover before acquiring: a stashed id is retried as a heartbeat so a
        // single dropped beat cannot move the pet to the default target.
        if (this.staleLeaseId !== null) {
          try {
            await this.transport.heartbeat(this.staleLeaseId);
            this.leaseId = this.staleLeaseId;
            this.staleLeaseId = null;
            this.state = 'held';
            this.lastHeartbeatAt = this.now();
            this.scheduleHeartbeat();
            return this.leaseId;
          } catch {
            // The stale lease is genuinely gone; drop it and acquire fresh.
            this.staleLeaseId = null;
          }
        }

        const id = await this.transport.acquire();
        this.leaseId = id;
        this.state = 'held';
        this.lastHeartbeatAt = this.now();
        this.scheduleHeartbeat();
        return id;
      } catch {
        this.state = 'idle';
        return null;
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  /** Explicit heartbeat; normally driven by the internal timer. */
  async heartbeat(): Promise<boolean> {
    if (this.leaseId === null) return false;
    try {
      await this.transport.heartbeat(this.leaseId);
      this.lastHeartbeatAt = this.now();
      this.heartbeatFailures = 0;
      return true;
    } catch (error) {
      this.heartbeatFailures += 1;
      // Preserve the id: losing it here is what silently re-routes the pet.
      this.staleLeaseId = this.leaseId;
      this.onHeartbeatError?.(error);
      return false;
    }
  }

  /** Release once. Safe to call repeatedly and from several shutdown paths. */
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.state = 'releasing';
    this.clearTimer();

    const id = this.leaseId ?? this.staleLeaseId;
    this.leaseId = null;
    this.staleLeaseId = null;
    this.state = 'closed';

    if (id === null) return;
    try {
      await this.transport.release(id);
    } catch {
      // The TTL reclaims it; a failing release must not block shutdown.
    }
  }

  snapshot(): LeaseSnapshot {
    return {
      state: this.state,
      leaseId: this.leaseId,
      staleLeaseId: this.staleLeaseId,
      lastHeartbeatAt: this.lastHeartbeatAt,
      heartbeatFailures: this.heartbeatFailures,
      released: this.released,
    };
  }

  private scheduleHeartbeat(): void {
    if (this.released) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.heartbeat().then(() => {
        if (!this.released) this.scheduleHeartbeat();
      });
    }, this.heartbeatMs);
    // Do not hold the process open for pet bookkeeping.
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
