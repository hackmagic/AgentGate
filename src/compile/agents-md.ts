import type { Policy } from '../policy/types.js';
import { COMPILE_FORMAT_VERSION, ENGINE_VERSION } from '../version.js';
import {
  actionLines,
  decisionText,
  engineRuleLines,
  presentationLines,
  safetyLines,
  sourceHash,
  triggerLines,
} from './support.js';

/**
 * Compile policies into an AGENTS.md section set. One policy becomes one
 * chapter so a human can diff a policy change against the agent contract.
 */
export function compileAgentsMd(policies: readonly Policy[]): string {
  const lines: string[] = [];
  lines.push('# 个人引导策略（由 AgentGate 编译，请勿手改）');
  lines.push('');
  lines.push(
    `本文件由 agent-gate v${ENGINE_VERSION} 以编译格式 v${COMPILE_FORMAT_VERSION} 从 ${policies.length} 条策略生成。修改请改 \`packs/*/policies/*.yaml\` 后重新编译。`,
  );
  lines.push('');
  lines.push('## 通用求值规则');
  lines.push('');
  lines.push(...engineRuleLines());
  lines.push('');
  lines.push('## 边界');
  lines.push('');
  lines.push('- 你是执行者，不是策略制定者：不要自行发明新的引导规则。');
  lines.push('- 每次需要引导时，先调用 `gate/evaluate`，按返回的 `decision` 行动。');
  lines.push('- 未经批准不得执行 `require_approval` 策略描述的动作。');
  lines.push('- 用户拒绝后不要自动重试同一引导。');

  for (const policy of policies) {
    lines.push('');
    lines.push(`## ${policy.description}`);
    lines.push('');
    lines.push(`> 策略 \`${policy.id}\` v${policy.version} · 优先级 ${policy.priority} · 源哈希 \`${sourceHash(policy).slice(0, 12)}\``);
    lines.push('');
    lines.push('### 何时适用');
    lines.push('');
    lines.push(...triggerLines(policy));
    lines.push('');
    lines.push('### 行为规则');
    lines.push('');
    lines.push(`- 决策：\`${policy.decision}\` — ${decisionText(policy.decision)}`);
    lines.push(...actionLines(policy));
    lines.push('');
    lines.push('### 禁止事项');
    lines.push('');
    lines.push(...safetyLines(policy));
    lines.push('');
    lines.push('### 呈现');
    lines.push('');
    const presentation = presentationLines(policy);
    lines.push(...(presentation.length > 0 ? presentation : ['- 使用引擎默认呈现。']));
  }

  lines.push('');
  return lines.join('\n');
}
