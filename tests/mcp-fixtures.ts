import { MemoryAuditStore } from '../src/audit/store.js';
import type { Policy } from '../src/policy/types.js';

/** One approval-gated policy, enough to exercise every MCP surface. */
export function makePolicies(): Policy[] {
  return [
    {
      id: 'mcp-focus',
      version: 1,
      description: '专注块开始时请求批准静默通知',
      priority: 50,
      trigger: { event: 'focus_block_started', context: { app: ['code'] } },
      decision: 'require_approval',
      action: { type: 'suppress_notifications', scope: ['slack'], parameters: { duration_minutes: 25 } },
      safety: { requires_approval: true, reversible: true, audit_level: 'full' },
      presentation: {
        animation_hint: 'alert',
        bubble_text: '进入专注？',
        actions: [
          { label: '批准', action_id: 'approve' },
          { label: '忽略', action_id: 'dismiss' },
        ],
      },
    },
  ];
}

export function makeAudit(): MemoryAuditStore {
  return new MemoryAuditStore();
}
