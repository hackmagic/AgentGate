import type { Condition, Policy, PolicyDecision } from '../policy/types.js';
import { isConditionGroup } from '../policy/types.js';
import { sha256, stableStringify } from '../util/hash.js';

const DECISION_TEXT: Record<PolicyDecision, string> = {
  suggest: '给出建议，用户可以接受或忽略',
  require_approval: '必须先取得用户批准，批准前不得执行',
  suppress: '不打扰用户；按规则静默处理',
  allow: '放行，不产生任何引导',
};

const EVENT_TEXT: Record<string, string> = {
  focus_block_started: '进入专注时段',
  focus_block_ended: '专注时段结束',
  app_switch: '切换应用',
  idle_detected: '检测到离开',
  interruption: '出现打断',
  notification_received: '收到通知',
};

export function sourceHash(policy: Policy): string {
  return sha256(stableStringify(policy));
}

export function decisionText(decision: PolicyDecision): string {
  return DECISION_TEXT[decision];
}

export function triggerLines(policy: Policy): string[] {
  const lines = [`- 事件：${EVENT_TEXT[policy.trigger.event] ?? policy.trigger.event} (\`${policy.trigger.event}\`)`];
  const context = policy.trigger.context;
  if (context?.app !== undefined) lines.push(`- 应用：${context.app.join(', ')}`);
  if (context?.project !== undefined) lines.push(`- 项目：${context.project.join(', ')}`);
  if (context?.language !== undefined) lines.push(`- 语言：${context.language.join(', ')}`);
  if (policy.conditions !== undefined) lines.push(`- 条件：${describeCondition(policy.conditions)}`);
  return lines;
}

export function describeCondition(condition: Condition | Condition[]): string {
  if (Array.isArray(condition)) {
    return condition.map((entry) => describeCondition(entry)).join(' 且 ');
  }
  if (isConditionGroup(condition)) {
    if ('all' in condition) return `(${condition.all.map((entry) => describeCondition(entry)).join(' 且 ')})`;
    if ('any' in condition) return `(${condition.any.map((entry) => describeCondition(entry)).join(' 或 ')})`;
    return `非 ${describeCondition(condition.not)}`;
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(condition)) {
    if (Array.isArray(value)) {
      parts.push(`${key} 属于 [${value.join(', ')}]`);
    } else {
      parts.push(`${key} = ${String(value)}`);
    }
  }
  return parts.length === 0 ? '（空条件）' : parts.join(' 且 ');
}

export function safetyLines(policy: Policy): string[] {
  const safety = policy.safety;
  const lines: string[] = [];
  lines.push(
    safety.requires_approval
      ? '- 需要用户明确批准后才能影响系统状态。'
      : `- 不需要逐次批准，理由：${safety.rationale ?? '（未说明，属于校验错误）'}`,
  );
  lines.push(
    safety.reversible
      ? '- 动作可撤销；撤销方式写在该策略的 action 里。'
      : '- 动作不可撤销：未获批准时一律按最保守方式处理。',
  );
  lines.push(`- 审计级别：${safety.audit_level}；每一条引导及用户回执都会写入审计。`);
  lines.push('- 不得截屏、读取完整窗口标题、剪贴板或按键序列来"理解"用户。');
  return lines;
}

export function actionLines(policy: Policy): string[] {
  if (policy.action === undefined) return ['- 无动作：只表达态度，不触碰任何系统状态。'];
  const lines = [`- 动作类型：\`${policy.action.type}\``];
  if (policy.action.scope !== undefined) lines.push(`- 作用范围：${policy.action.scope.join(', ')}`);
  for (const [key, value] of Object.entries(policy.action.parameters ?? {})) {
    lines.push(`- 参数 \`${key}\`：${JSON.stringify(value)}`);
  }
  if (policy.escalation !== undefined) {
    lines.push(
      `- 升级：${policy.escalation.after_minutes} 分钟后若仍未响应，转为 \`${policy.escalation.decision ?? 'suggest'}\` 并执行 \`${policy.escalation.action}\`。`,
    );
  }
  return lines;
}

export function presentationLines(policy: Policy): string[] {
  const lines: string[] = [];
  const bubble = policy.presentation?.bubble_text;
  const hint = policy.presentation?.animation_hint;
  if (bubble !== undefined) lines.push(`- 气泡文案（固定，不得由模型即兴生成）：${bubble}`);
  if (hint !== undefined) lines.push(`- 动画提示：${hint}`);
  const actions = policy.presentation?.actions;
  if (actions !== undefined && actions.length > 0) {
    lines.push(`- 可选回执：${actions.map((action) => `${action.label}(\`${action.action_id}\`)`).join('、')}`);
  }
  return lines;
}

export function engineRuleLines(): string[] {
  return [
    '1. `suppress` + `requires_approval: true` 只能产出审批请求，不得直接执行。',
    '2. `requires_approval: false` 必须写明 `rationale`，否则策略校验失败。',
    '3. 同一事件按 `priority` 降序求值，第一条非 `allow` 的策略终止求值。',
    '4. 任何策略求值出错都降级为 `allow` 并写审计，绝不阻塞用户。',
    '5. 连续 3 次 dismiss 后该策略静音，并提示用户修订策略。',
  ];
}
