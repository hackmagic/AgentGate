import { MemoryAuditStore } from '../src/audit/store.js';
import type { GuidanceEvent } from '../src/events/types.js';
import type { Policy } from '../src/policy/types.js';
import { manualClock } from '../src/util/clock.js';

/** Friday 2026-11-20, 09:00 in Asia/Shanghai. */
export const NOW = '2026-11-20T01:00:00.000Z';
export const TZ = 'Asia/Shanghai';

/** A valid `suggest` policy; override anything per test. */
export function makePolicy(overrides: Partial<Policy> & { id: string }): Policy {
  const base: Policy = {
    id: overrides.id,
    version: 1,
    description: 'test policy',
    priority: 50,
    trigger: { event: 'focus_block_started' },
    decision: 'suggest',
    safety: {
      requires_approval: false,
      rationale: 'only shows one local bubble; nothing is changed',
      reversible: true,
      audit_level: 'summary',
    },
    presentation: {
      animation_hint: 'stretch',
      bubble_text: '休息一下？',
      actions: [
        { label: '好', action_id: 'approve' },
        { label: '忽略', action_id: 'dismiss' },
      ],
    },
  };
  return { ...base, ...overrides };
}

export function makeEvent(overrides: Partial<GuidanceEvent> = {}): GuidanceEvent {
  const base: GuidanceEvent = {
    id: 'evt-1',
    type: 'focus_block_started',
    timestamp: NOW,
    source: 'manual',
    context: { app: 'Code', project: 'guidance-runtime', language: 'typescript' },
    duration_seconds: null,
    metrics: {},
    metadata: {},
  };
  return { ...base, ...overrides, context: { ...base.context, ...(overrides.context ?? {}) } };
}

export function sequentialIds(prefix = 'sig'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

export function makeClock() {
  return manualClock(NOW);
}

export function newAudit() {
  return new MemoryAuditStore();
}
