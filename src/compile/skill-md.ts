import type { Policy } from '../policy/types.js';
import { COMPILE_FORMAT_VERSION } from '../version.js';
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
 * Compile one policy into an Agent Skill (SKILL.md).
 *
 * Shape is governed by docs/06-compiler-spec.md §7, which states the minimum
 * for a *usable* skill: a reader must be able to discover it, know when it
 * applies, parse every offered action id, and know what to do when the tool is
 * unreachable. See that section before changing any line here — several of the
 * lines look redundant until you know which requirement they satisfy.
 */
export function compileSkillMd(policy: Policy): CompiledSkill {
  const name = `agent-gate-${policy.id.replace(/[^a-z0-9-]+/g, '-')}`;
  const description = buildDescription(policy);
  const actionIds = (policy.presentation?.actions ?? []).map((action) => action.action_id);

  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${policy.description}`);
  lines.push('');
  lines.push(
    `策略 \`${policy.id}\` v${policy.version}。由 AgentGate 以编译格式 v${COMPILE_FORMAT_VERSION} 生成，源哈希 \`${sourceHash(policy)}\`。`,
  );
  lines.push('');
  lines.push('## 何时适用');
  lines.push('');
  lines.push(...triggerLines(policy));
  lines.push('');
  lines.push('## Instructions');
  lines.push('');
  lines.push('1. 在动作发生前，调用 MCP 工具 `gate/evaluate`，传入当前规范化事件。');
  lines.push('2. 读取返回的 `decision`：');
  lines.push(`   - \`${policy.decision}\` → ${decisionText(policy.decision)}`);
  lines.push('   - `allow` → 继续你原本的计划，不要提及这条策略。');
  lines.push('3. 若返回 `signal`，把 `presentation.bubble_text` 与 `presentation.actions` 原样交给呈现层；不得改写文案。');
  lines.push('4. 用户回执后，把 `signal_id` 与 `action_id` 回传给呈现层所在的运行时。');
  lines.push('');
  lines.push('### 回传回执');
  lines.push('');
  lines.push(
    'MCP 入口是**无状态**的，只提供 `gate/evaluate`、`gate/list-policies`、`gate/audit-query` 三个工具，' +
      '**没有接收用户回执的工具**。回执必须走宠物桥：',
  );
  lines.push('');
  lines.push('```http');
  lines.push('POST /v1/signals/{signal_id}/respond');
  lines.push('{ "action_id": "<见下表>", "responded_at": "<ISO 8601>" }');
  lines.push('```');
  lines.push('');
  lines.push('可用的 `action_id`（只有这些，不得自造）：');
  lines.push('');
  for (const actionId of actionIds.length === 0 ? ['approve', 'dismiss'] : actionIds) {
    lines.push(`- \`${actionId}\``);
  }
  lines.push('');
  lines.push(
    '**没有宠物桥时**：不要假装用户批准过。把 signal 的文案与动作原样转述给用户，等用户真正回话，' +
      '然后把本次结果标记为「未回执」。宁可少做一步，也不要替用户按下批准。',
  );
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

/**
 * Frontmatter description.
 *
 * Hosts show this string in a skill list before anything else, so it has to
 * carry the decision *and* the approval stance: a reader scanning ten skills
 * needs to know which one will stop them, without opening any of them.
 */
function buildDescription(policy: Policy): string {
  const approval = policy.safety.requires_approval ? '必须先取得用户批准' : '不需要逐次批准';
  return `${policy.description}（个人引导策略 ${policy.id}：${decisionText(policy.decision)}，${approval}）`.slice(0, 1000);
}

/** Expand multiple policies into one skill per policy. */
export function compileSkills(policies: readonly Policy[]): CompiledSkill[] {
  return policies.map((policy) => compileSkillMd(policy));
}
