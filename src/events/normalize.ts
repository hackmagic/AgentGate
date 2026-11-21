import { randomUUID } from 'node:crypto';

import { ContractError } from '../errors.js';
import { loadSchema } from '../schema/load.js';
import { validateSchema } from '../schema/validator.js';
import type { EventContext, EventSource, GuidanceEvent, GuidanceEventType } from './types.js';

export interface NormalizeEventOptions {
  /** Override id generation, mainly for deterministic fixtures. */
  idFactory?: () => string;
}

/** Validate an untrusted payload and fill in optional fields with defaults. */
export function normalizeEvent(raw: unknown, options: NormalizeEventOptions = {}): GuidanceEvent {
  const result = validateSchema(raw, loadSchema('event'));
  if (!result.valid) {
    throw new ContractError('invalid_event', 'event does not satisfy schemas/event.schema.json', result.issues);
  }

  const value = raw as Record<string, unknown>;
  const context = value.context as EventContext;
  const idFactory = options.idFactory ?? randomUUID;

  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : idFactory(),
    type: value.type as GuidanceEventType,
    timestamp: value.timestamp as string,
    source: value.source as EventSource,
    context: {
      app: context.app,
      project: context.project ?? null,
      language: context.language ?? null,
    },
    duration_seconds: typeof value.duration_seconds === 'number' ? value.duration_seconds : null,
    metrics: isNumberRecord(value.metrics) ? { ...value.metrics } : {},
    metadata: isPlainObject(value.metadata) ? { ...value.metadata } : {},
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === 'number');
}
