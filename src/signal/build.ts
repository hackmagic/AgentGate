import { addMinutes } from '../util/clock.js';
import { truncateChars } from '../util/text.js';
import type { GuidanceEvent } from '../events/types.js';
import type { AnimationHint, Policy, SignalDecision } from '../policy/types.js';
import type { GuidanceSignal, SignalAction, SignalPresentation } from './types.js';

export const BUBBLE_MAX_CHARS = 30;

interface DefaultPresentation {
  animation_hint: AnimationHint;
  bubble_text: string;
  actions: SignalAction[];
}

const DEFAULT_PRESENTATION: Record<SignalDecision, DefaultPresentation> = {
  suggest: {
    animation_hint: 'stretch',
    bubble_text: '要不要休息一下？',
    actions: [
      { label: '好', action_id: 'approve' },
      { label: '忽略', action_id: 'dismiss' },
    ],
  },
  require_approval: {
    animation_hint: 'alert',
    bubble_text: '暂停非紧急通知？',
    actions: [
      { label: '批准', action_id: 'approve' },
      { label: '忽略', action_id: 'dismiss' },
      { label: '静默 1 小时', action_id: 'mute_1h' },
    ],
  },
  suppress: {
    animation_hint: 'thinking',
    bubble_text: '已按你的规则静默。',
    actions: [{ label: '知道了', action_id: 'dismiss' }],
  },
};

export interface BuildSignalOptions {
  now: Date;
  id: string;
  expires_at?: Date | null;
}

/**
 * Turn a matched policy into a signal. Presentation is always deterministic:
 * policy-provided copy wins, otherwise a fixed table is used.
 */
export function buildSignal(
  policy: Policy,
  event: GuidanceEvent,
  decision: SignalDecision,
  options: BuildSignalOptions,
): GuidanceSignal {
  const presentation = buildPresentation(policy, decision);
  const durationMinutes = readDurationMinutes(policy.action?.parameters);
  const expiresAt = options.expires_at ?? (durationMinutes === null ? null : addMinutes(options.now, durationMinutes));

  return {
    id: options.id,
    policy_id: policy.id,
    decision,
    presentation,
    action:
      policy.action === undefined
        ? null
        : {
            type: policy.action.type,
            scope: policy.action.scope ?? [],
            parameters: policy.action.parameters ?? {},
          },
    escalation:
      policy.escalation === undefined
        ? null
        : {
            after_minutes: policy.escalation.after_minutes,
            action: policy.escalation.action,
            decision: policy.escalation.decision ?? 'suggest',
          },
    expires_at: expiresAt === null ? null : expiresAt.toISOString(),
    created_at: options.now.toISOString(),
    trigger_event_id: event.id,
    audit_level: policy.safety.audit_level,
  };
}

export function buildPresentation(policy: Policy, decision: SignalDecision): SignalPresentation {
  const fallback = DEFAULT_PRESENTATION[decision];
  const configured = policy.presentation;

  const bubbleText = truncateChars(configured?.bubble_text ?? fallback.bubble_text, BUBBLE_MAX_CHARS);
  const actions = configured?.actions !== undefined && configured.actions.length > 0
    ? configured.actions.map((action) => ({ label: action.label, action_id: action.action_id }))
    : fallback.actions.map((action) => ({ ...action }));

  if (decision === 'require_approval' && !actions.some((action) => action.action_id !== 'approve')) {
    actions.push({ label: '忽略', action_id: 'dismiss' });
  }

  return {
    animation_hint: configured?.animation_hint ?? fallback.animation_hint,
    bubble_text: bubbleText,
    actions,
  };
}

function readDurationMinutes(parameters: Record<string, unknown> | undefined): number | null {
  if (parameters === undefined) return null;
  const value = parameters['duration_minutes'];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}
