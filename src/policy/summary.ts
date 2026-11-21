import type { GateSignal } from '../signal/types.js';
import type { Policy, TriggerContextMatcher } from './types.js';

export interface PolicySummary {
  id: string;
  version: number;
  description: string;
  priority: number;
  decision: Policy['decision'];
  trigger: { event: string; context?: TriggerContextMatcher };
  action: { type: string; scope: string[] } | null;
  requires_approval: boolean;
  audit_level: string;
}

export function summarizePolicy(policy: Policy): PolicySummary {
  return {
    id: policy.id,
    version: policy.version,
    description: policy.description,
    priority: policy.priority,
    decision: policy.decision,
    trigger:
      policy.trigger.context === undefined
        ? { event: policy.trigger.event }
        : { event: policy.trigger.event, context: policy.trigger.context },
    action: policy.action === undefined ? null : { type: policy.action.type, scope: policy.action.scope ?? [] },
    requires_approval: policy.safety.requires_approval,
    audit_level: policy.safety.audit_level,
  };
}

export function summarizeSignal(signal: GateSignal): Record<string, unknown> {
  return {
    id: signal.id,
    policy_id: signal.policy_id,
    decision: signal.decision,
    bubble_text: signal.presentation.bubble_text,
    actions: signal.presentation.actions.map((action) => action.action_id),
    expires_at: signal.expires_at,
  };
}
