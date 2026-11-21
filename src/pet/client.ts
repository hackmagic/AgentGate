import { AgentGateError } from '../errors.js';
import type { AgentEvent } from '../events/types.js';
import type { GateResponse, GateSignal } from '../signal/types.js';

/**
 * The client half of the pet protocol: what an embodiment actually calls.
 *
 * The bridge (`src/pet/http.ts`) is the server; this is the caller. Both
 * documentation halves of docs/07 already show this import in their adapter
 * sketch, so it has to exist rather than be illustrative.
 *
 * Design constraints, all inherited from the bridge:
 *
 * - **Loopback only.** The bridge binds `127.0.0.1`, and a client that will
 *   happily point at a remote host invites someone to expose an engine that
 *   can answer approval prompts. `loopback_only` enforces the default; a
 *   deliberate override is a separate, explicit option.
 * - **No runtime dependency.** Uses global `fetch`, so a pet plugin can bundle
 *   this without pulling anything in.
 * - **Never executes.** It reports a user's decision back. The action happens
 *   in the adapter that owns the capability, after the engine recorded it.
 */

export interface PetBridgeClientOptions {
  /** Bridge origin, e.g. `http://127.0.0.1:3778`. */
  baseUrl?: string;
  /**
   * Permit a non-loopback host. Off by default: an engine that dispenses
   * approval prompts should not be reachable across a network by accident.
   */
  allow_remote?: boolean;
  /** Per-request timeout in milliseconds. */
  timeout_ms?: number;
  /** Injectable for tests and for host environments without global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface PetHealth {
  status: string;
  engine_version: string;
  policy_count: number;
}

export interface PetEventOutcome {
  decision: string;
  signal: GateSignal | null;
  matched_policy_id: string | null;
  degraded: boolean;
  throttled: boolean;
  warnings?: string[];
  policy_count?: number;
}

export interface PetRespondOutcome {
  signal_id: string;
  action_id: string;
  muted_now: boolean;
  policy_muted: boolean;
}

export interface OnSignalOptions {
  /** Poll interval in milliseconds. */
  interval_ms?: number;
  /** Stop after this many milliseconds; omit to poll until `stop()` is called. */
  timeout_ms?: number;
  /** Called with every signal not seen in the previous poll. */
  onSignal: (signal: GateSignal) => void;
  /** Called when a poll fails; the poller keeps running. */
  onError?: (error: unknown) => void;
}

export interface SignalPoller {
  /** Resolves when polling stops, by timeout or by `stop()`. */
  done: Promise<void>;
  stop(): void;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

/** Thrown when a bridge URL points away from loopback without opting in. */
export class RemoteBridgeError extends AgentGateError {
  constructor(url: string) {
    super(
      'remote_bridge',
      `refusing to talk to a non-loopback bridge (${url}); pass allow_remote: true if that is intended`,
    );
    this.name = 'RemoteBridgeError';
  }
}

export class PetBridgeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly seen = new Set<string>();

  constructor(options: PetBridgeClientOptions = {}) {
    const baseUrl = options.baseUrl ?? 'http://127.0.0.1:3778';
    this.baseUrl = stripTrailingSlash(baseUrl);
    this.timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;

    if (options.allow_remote !== true && !isLoopbackUrl(this.baseUrl)) {
      throw new RemoteBridgeError(this.baseUrl);
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new AgentGateError('no_fetch', 'no global fetch available; pass options.fetch');
    }
    this.fetchImpl = fetchImpl;
  }

  /** GET /healthz */
  async health(): Promise<PetHealth> {
    return this.request<PetHealth>('GET', '/healthz');
  }

  /** POST /v1/events — submit one normalized event. */
  async evaluate(event: AgentEvent): Promise<PetEventOutcome> {
    return this.request<PetEventOutcome>('POST', '/v1/events', { event });
  }

  /** GET /v1/signals/pending */
  async pending(): Promise<GateSignal[]> {
    const body = await this.request<{ signals: GateSignal[] }>('GET', '/v1/signals/pending');
    return body.signals;
  }

  /**
   * POST /v1/signals/:id/respond
   *
   * This is the only method through which a user decision re-enters the engine,
   * and it carries no capability: it reports, it does not act.
   */
  async respond(signalId: string, actionId: GateResponse['action_id'], respondedAt = new Date()): Promise<PetRespondOutcome> {
    return this.request<PetRespondOutcome>('POST', `/v1/signals/${encodeURIComponent(signalId)}/respond`, {
      action_id: actionId,
      responded_at: respondedAt.toISOString(),
    });
  }

  /**
   * Poll `pending()` and surface each signal once.
   *
   * Signals are de-duplicated by id rather than by arrival: the bridge may
   * return the same unanswered signal on every poll, and an embodiment that
   * re-shows it would turn a single prompt into a nag.
   */
  onSignal(options: OnSignalOptions): SignalPoller {
    const interval = options.interval_ms ?? DEFAULT_POLL_INTERVAL_MS;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let resolveDone: () => void = () => {};

    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (deadline !== undefined) clearTimeout(deadline);
      resolveDone();
    };

    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        for (const signal of await this.pending()) {
          if (stopped) return;
          if (this.seen.has(signal.id)) continue;
          this.seen.add(signal.id);
          options.onSignal(signal);
        }
      } catch (error) {
        // A bridge that is briefly down (the engine restarted) must not kill
        // the poller: the next tick retries. Surfacing it is the caller's job.
        options.onError?.(error);
      }
      if (stopped) return;
      timer = setTimeout(() => void tick(), interval);
    };

    if (options.timeout_ms !== undefined) deadline = setTimeout(stop, options.timeout_ms);
    void tick();

    return { done, stop };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const text = await response.text();
      const parsed = text.trim() === '' ? {} : (JSON.parse(text) as unknown);

      if (!response.ok) {
        const detail = isRecord(parsed) && isRecord(parsed['error']) ? parsed['error'] : null;
        const code = typeof detail?.['code'] === 'string' ? detail['code'] : `http_${response.status}`;
        const message = typeof detail?.['message'] === 'string' ? detail['message'] : `HTTP ${response.status}`;
        throw new AgentGateError(code, message);
      }

      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
