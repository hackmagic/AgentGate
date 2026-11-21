import type { ActionId, AnimationHint, AuditLevel, SignalDecision } from '../policy/types.js';

export interface SignalAction {
  label: string;
  action_id: ActionId;
}

export interface SignalPresentation {
  animation_hint: AnimationHint;
  /** Deterministic copy from policy (never LLM-generated). */
  bubble_text: string;
  actions: SignalAction[];
}

export interface SignalActionPlan {
  type: string;
  scope: string[];
  parameters: Record<string, unknown>;
}

export interface SignalEscalation {
  after_minutes: number;
  action: string;
  decision: SignalDecision;
}

/**
 * The only thing the policy engine hands to an embodiment layer. It carries
 * intent plus a presentation contract — never a command to touch the system.
 */
export interface GuidanceSignal {
  id: string;
  policy_id: string;
  decision: SignalDecision;
  presentation: SignalPresentation;
  action: SignalActionPlan | null;
  escalation: SignalEscalation | null;
  expires_at: string | null;
  created_at: string;
  trigger_event_id: string;
  audit_level: AuditLevel;
}

export interface GuidanceResponse {
  signal_id: string;
  action_id: ActionId;
  responded_at: string;
}
