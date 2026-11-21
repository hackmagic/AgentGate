import type { Policy } from '../policy/types.js';
import { COMPILE_FORMAT_VERSION, ENGINE_VERSION } from '../version.js';
import { decisionText, sourceHash, triggerLines } from './support.js';

export interface McpBundleFile {
  path: string;
  content: string;
}

/**
 * Compile policies into a self-contained MCP server bundle: a host config that
 * launches `agent-gate mcp`, copies of the policy files, and a README
 * that explains the three tools and the approval contract.
 */
export function compileMcpBundle(policies: readonly Policy[]): McpBundleFile[] {
  const files: McpBundleFile[] = [];

  files.push({
    path: 'mcp.json',
    content: `${JSON.stringify(
      {
        mcpServers: {
          'agent-gate': {
            command: 'npx',
            args: ['-y', 'agent-gate', 'mcp', '--policy', './agent-gate-policies'],
            env: { AGENT_GATE_ENGINE_VERSION: ENGINE_VERSION },
          },
        },
      },
      null,
      2,
    )}\n`,
  });

  for (const policy of policies) {
    files.push({
      path: `agent-gate-policies/${policy.id}.yaml`,
      content: `${JSON.stringify({ policy }, null, 2)}\n`,
    });
  }

  files.push({ path: 'README.md', content: renderReadme(policies) });
  return files;
}

function renderReadme(policies: readonly Policy[]): string {
  const lines: string[] = [];
  lines.push('# AgentGate MCP bundle');
  lines.push('');
  lines.push(
    `由 agent-gate v${ENGINE_VERSION} 以编译格式 v${COMPILE_FORMAT_VERSION} 编译，包含 ${policies.length} 条策略。把 \`mcp.json\` 里的 \`agent-gate\` 条目合并进你的 MCP 客户端配置即可。`,
  );
  lines.push('');
  lines.push('## 工具');
  lines.push('');
  lines.push('| 工具 | 输入 | 输出 |');
  lines.push('| --- | --- | --- |');
  lines.push('| `gate/evaluate` | `{ event }` | `{ decision, signal, matched_policy_id, degraded }` |');
  lines.push('| `gate/list-policies` | `{}` | 策略清单 |');
  lines.push('| `gate/audit-query` | `{ since?, policy_id?, limit? }` | 内容无关的审计记录 |');
  lines.push('');
  lines.push('## 契约');
  lines.push('');
  lines.push('- 服务端无状态：每个请求自带事件，服务端不缓存图片、窗口标题或剪贴板。');
  lines.push('- `signal` 是唯一可呈现给用户的载荷；文案来自策略，不接受模型即兴生成。');
  lines.push('- `decision: require_approval` 时，未收到 `approve` 回执不得执行动作。');
  lines.push('- 用户 `dismiss` 后同一策略不得自动重试；连续 3 次后静音。');
  lines.push('');
  lines.push('## 策略');
  lines.push('');
  for (const policy of policies) {
    lines.push(`### ${policy.description}`);
    lines.push('');
    lines.push(`\`${policy.id}\` v${policy.version} · \`${policy.decision}\` — ${decisionText(policy.decision)} · 源哈希 \`${sourceHash(policy).slice(0, 12)}\``);
    lines.push('');
    lines.push(...triggerLines(policy));
    lines.push('');
  }
  return lines.join('\n');
}
