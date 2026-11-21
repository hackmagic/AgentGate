import type { Policy } from '../policy/types.js';
import {
  actionLines,
  decisionText,
  presentationLines,
  safetyLines,
  sourceHash,
  triggerLines,
} from './support.js';

export interface CompiledSkill {
  name: string;
  content: string;
}

/**
 * Compile one policy into an Agent Skill (SKILL.md). Skills are where an agent
 * "reads the user's boundaries before acting"; the description doubles as the
 * frontmatter the host uses for discovery.
 */
export function compileSkillMd(policy: Policy): CompiledSkill {
  const name = `guidance-${policy.id.replace(/[^a-z0-9-]+/g, '-')}`;
  const description = `${policy.description}（个人引导策略 ${policy.id}：${decisionText(policy.decision)}）`.slice(0, 1000);

  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${policy.description}`);
  lines.push('');
  lines.push(`策略 \`${policy.id}\` v${policy.version}。由 guidance-runtime 编译，源哈希 \`${sourceHash(policy)}\`。`);
  lines.push('');
  lines.push('## 何时适用');
  lines.push('');
  lines.push(...triggerLines(policy));
  lines.push('');
  lines.push('## Instructions');
  lines.push('');
  lines.push('1. 在动作发生前，调用 MCP 工具 `guidance/evaluate`，传入当前规范化事件。');
  lines.push('2. 读取返回的 `decision`：');
  lines.push(`   - \`${policy.decision}\` → ${decisionText(policy.decision)}`);
  lines.push('   - `allow` → 继续你原本的计划，不要提及这条策略。');
  lines.push('3. 若返回 `signal`，把 `presentation.bubble_text` 与 `presentation.actions` 原样交给呈现层；不得改写文案。');
  lines.push('4. 用户回执后，把 `signal_id` 与 `action_id` 回传给 `guidance/evaluate` 所在运行时（或宠物适配器）；不要自行推断用户意图。');
  lines.push('');
  lines.push('该策略定义的动作：');
  lines.push('');
  lines.push(...actionLines(policy));
  lines.push('');
  lines.push('## 呈现约束');
  lines.push('');
  const presentation = presentationLines(policy);
  lines.push(...(presentation.length > 0 ? presentation : ['- 使用引擎默认呈现。']));
  lines.push('- 气泡文案与动画只能来自策略；禁止用生成模型即兴创作用户可见的引导文案。');
  lines.push('');
  lines.push('## 禁止事项');
  lines.push('');
  lines.push(...safetyLines(policy));
  lines.push('- 用户的拒绝是最终结果：不要换个说法重试同一条引导。');
  lines.push('');
  lines.push('## 拒绝与静音');
  lines.push('');
  lines.push('- `dismiss`：本次不执行，且不得自动重试。');
  lines.push('- `mute_1h`：一小时内不再呈现该策略。');
  lines.push('- 连续 3 次 `dismiss` 后引擎会静音该策略，并建议用户修订。');
  lines.push('');
  return { name, content: lines.join('\n') };
}

/** Expand multiple policies into one skill per policy. */
export function compileSkills(policies: readonly Policy[]): CompiledSkill[] {
  return policies.map((policy) => compileSkillMd(policy));
}
