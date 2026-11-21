/** The six normalised event types the engine understands (MVP implements the first three). */
export const EVENT_TYPES = [
  'focus_block_started',
  'focus_block_ended',
  'app_switch',
  'idle_detected',
  'interruption',
  'notification_received',
] as const;

export type GuidanceEventType = (typeof EVENT_TYPES)[number];

export const EVENT_SOURCES = ['activitywatch', 'screenpipe', 'manual'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export interface EventContext {
  app: string;
  project: string | null;
  language: string | null;
}

/**
 * Semantic superset of ActivityWatch / screenpipe events. `metadata` exists so
 * adapters can keep raw producer fields, but the engine must never read it.
 */
export interface GuidanceEvent {
  id: string;
  type: GuidanceEventType;
  /** ISO 8601 instant. */
  timestamp: string;
  source: EventSource;
  context: EventContext;
  duration_seconds: number | null;
  /** Optional numeric observations such as `focus_score`. */
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
}

export function isGuidanceEventType(value: unknown): value is GuidanceEventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

export function isEventSource(value: unknown): value is EventSource {
  return typeof value === 'string' && (EVENT_SOURCES as readonly string[]).includes(value);
}
