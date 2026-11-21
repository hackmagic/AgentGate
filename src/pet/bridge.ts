import { ContractError, GuidanceError } from '../errors.js';
import type { GuidanceEngine, EvaluateOutcome, RespondOutcome } from '../engine.js';
import { normalizeEvent } from '../events/normalize.js';
import type { GuidanceEvent } from '../events/types.js';
import { loadSchema } from '../schema/load.js';
import { validateSchema } from '../schema/validator.js';
import type { GuidanceSignal } from '../signal/types.js';

export const PET_ENGINE_NAME = 'guidance-runtime';

export interface PetBridgeOptions {
  engine: GuidanceEngine;
  /** Hard cap on event submissions per minute; excess is 429. */
  max_events_per_minute?: number;
}

export interface PetEventResult extends EvaluateOutcome {
  policy_count: number;
}

export interface PetResponseResult extends RespondOutcome {
  signal_id: string;
  action_id: string;
}

export class RateLimitError extends GuidanceError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('rate_limited', `too many requests; retry in ${retryAfterSeconds}s`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Transport-agnostic pet protocol. Embodiments (a desktop pet, a HUD, a CLI
 * prompt) only ever *see* signals and *send back* responses — no adapter gets
 * to ask the engine to execute anything.
 */
export class PetBridge {
  private readonly engine: GuidanceEngine;
  private readonly maxEventsPerMinute: number;
  private eventTimestamps: number[] = [];

  constructor(options: PetBridgeOptions) {
    this.engine = options.engine;
    this.maxEventsPerMinute = options.max_events_per_minute ?? 60;
  }

  /** POST /v1/events — adapter reports one normalised event. */
  handleEvent(payload: unknown, now: Date = new Date()): PetEventResult {
    this.checkRateLimit(now);
    const event = this.parseEvent(payload);
    return { ...this.engine.evaluate(event, now), policy_count: this.engine.policyCount };
  }

  /** POST /v1/signals/:id/respond — user answered a shown signal. */
  handleResponse(signalId: string, payload: unknown): PetResponseResult {
    const response = this.parseResponse(signalId, payload);
    const outcome = this.engine.respond(response);
    return { ...outcome, signal_id: signalId, action_id: response.action_id };
  }

  /** GET /v1/signals/pending */
  pending(): GuidanceSignal[] {
    return this.engine.pending();
  }

  health(): { status: 'ok'; engine_version: string; policy_count: number } {
    return {
      status: 'ok',
      engine_version: this.engine.engineVersionNumber,
      policy_count: this.engine.policyCount,
    };
  }

  private parseEvent(payload: unknown): GuidanceEvent {
    const result = validateSchema(payload, loadSchema('pet-contract'));
    if (isRecord(payload) && !('event' in payload)) {
      // A bare event body is accepted for convenience; wrappers are canonical.
      return normalizeEvent(payload);
    }
    if (!result.valid) {
      throw new ContractError('invalid_event_request', 'body must be {"event": {...}}', result.issues);
    }
    return normalizeEvent((payload as { event: unknown }).event);
  }

  private parseResponse(signalId: string, payload: unknown) {
    if (!isRecord(payload)) {
      throw new ContractError('invalid_response', 'body must be {"action_id": "...", "responded_at": "..."}');
    }
    const actionId = payload['action_id'];
    const respondedAt = payload['responded_at'];
    if (typeof actionId !== 'string' || !['approve', 'dismiss', 'mute_1h'].includes(actionId)) {
      throw new ContractError('invalid_response', 'action_id must be one of approve, dismiss, mute_1h');
    }
    if (typeof respondedAt !== 'string' || Number.isNaN(Date.parse(respondedAt))) {
      throw new ContractError('invalid_response', 'responded_at must be an ISO 8601 instant');
    }
    return {
      signal_id: signalId,
      action_id: actionId as 'approve' | 'dismiss' | 'mute_1h',
      responded_at: respondedAt,
    };
  }

  private checkRateLimit(now: Date): void {
    const windowStart = now.getTime() - 60_000;
    this.eventTimestamps = this.eventTimestamps.filter((timestamp) => timestamp > windowStart);
    if (this.eventTimestamps.length >= this.maxEventsPerMinute) {
      const oldest = this.eventTimestamps[0] ?? now.getTime();
      const retryAfter = Math.max(1, Math.ceil((oldest + 60_000 - now.getTime()) / 1000));
      throw new RateLimitError(retryAfter);
    }
    this.eventTimestamps.push(now.getTime());
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
