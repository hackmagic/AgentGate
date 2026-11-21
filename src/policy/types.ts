import type { AgentEventType } from '../events/types.js';

export const POLICY_DECISIONS = ['suggest', 'require_approval', 'suppress', 'allow'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

/** Decisions a signal may carry; `allow` never becomes a signal. */
export const SIGNAL_DECISIONS = ['suggest', 'require_approval', 'suppress'] as const;
export type SignalDecision = (typeof SIGNAL_DECISIONS)[number];

export const AUDIT_LEVELS = ['full', 'summary', 'none'] as const;
export type AuditLevel = (typeof AUDIT_LEVELS)[number];

export const ANIMATION_HINTS = ['idle_shift', 'stretch', 'alert', 'thinking'] as const;
export type AnimationHint = (typeof ANIMATION_HINTS)[number];

/** The only actions a pet runtime may send back for a signal. */
export const ACTION_IDS = ['approve', 'dismiss', 'mute_1h'] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface TriggerContextMatcher {
  app?: string[];
  project?: string[];
  language?: string[];
}

export interface PolicyTrigger {
  event: AgentEventType;
  context?: TriggerContextMatcher;
}

export type ConditionValue = string | number | boolean | string[];

/** A leaf compares one or more event facets; all keys are ANDed. */
export interface ConditionLeaf {
  [key: string]: ConditionValue;
}

export interface ConditionGroupAll {
  all: Condition[];
}
export interface ConditionGroupAny {
  any: Condition[];
}
export interface ConditionGroupNot {
  not: Condition;
}
export type ConditionGroup = ConditionGroupAll | ConditionGroupAny | ConditionGroupNot;
export type Condition = ConditionGroup | ConditionLeaf;

export interface PolicyAction {
  type: string;
  scope?: string[];
  parameters?: Record<string, unknown>;
}

export interface PolicyEscalation {
  after_minutes: number;
  action: string;
  decision?: SignalDecision;
}

export interface PolicySafety {
  requires_approval: boolean;
  /** Mandatory when `requires_approval` is false. */
  rationale?: string;
  reversible: boolean;
  audit_level: AuditLevel;
}

export interface PresentationAction {
  label: string;
  action_id: ActionId;
}

export interface PolicyPresentation {
  animation_hint?: AnimationHint;
  /** Deterministic user-facing copy, at most 30 characters. */
  bubble_text?: string;
  actions?: PresentationAction[];
}

export interface Policy {
  id: string;
  version: number;
  description: string;
  priority: number;
  trigger: PolicyTrigger;
  conditions?: Condition;
  decision: PolicyDecision;
  action?: PolicyAction;
  escalation?: PolicyEscalation;
  safety: PolicySafety;
  presentation?: PolicyPresentation;
}

/** Canonical on-disk shape: a single `policy:` mapping per file. */
export interface PolicyDocument {
  policy: Policy;
}

export type PolicyInput = PolicyDocument | Policy;

export function isConditionGroup(condition: Condition): condition is ConditionGroup {
  return 'all' in condition || 'any' in condition || 'not' in condition;
}

export function unwrapPolicy(input: PolicyInput): Policy {
  if ('policy' in input) return input.policy;
  return input;
}

export function comparePolicyPriority(a: Policy, b: Policy): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id.localeCompare(b.id);
}
