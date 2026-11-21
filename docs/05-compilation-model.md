# 05 · 编译模型（跨 Agent）

一条策略源，编译成三种目标形态。参考 transskill 的适配器模式：**源格式 → 目标适配器 → 输出**，不手写多份。

入口：`compilePolicies(policies, target)`，`target ∈ {agents, skill, mcp}`。

## 映射规则

| 策略字段 | → `AGENTS.md` | → `SKILL.md` | → MCP Server |
| --- | --- | --- | --- |
| `description` | 章节标题 | frontmatter `description` | `server/discover` 与 README 摘要 |
| `trigger` + `conditions` | 「何时适用」段落 | Instructions 中的条件描述 | `guidance/evaluate` 的 `inputSchema` 约束 |
| `decision` + `action` | 「行为规则」段落 | Instructions 中的动作说明 | 返回值的 `decision` 字段 |
| `safety` | 「禁止事项」段落 | Instructions 中的边界 | `requires_approval` 元数据 |
| `presentation` | 「呈现」段落 | 呈现约束 | `signal.presentation` |

## 三种产物

### AGENTS.md

```
# 个人引导策略（由 guidance-runtime 编译，请勿手改）
## 通用求值规则       ← 五条语义规则
## 边界               ← 执行者不是策略制定者
## {description}      ← 每条策略一章
   ### 何时适用
   ### 行为规则
   ### 禁止事项
   ### 呈现
```

一章一策略，便于把策略变更 diff 到 Agent 契约上。

### SKILL.md

每个策略一个技能，目录 `skills/guidance-<policy-id>/SKILL.md`：

```yaml
---
name: guidance-morning-focus-protection
description: 工作日早上进入专注块时...（个人引导策略 morning-focus-protection：必须先取得用户批准）
---
```

正文的 Instructions 明确四步：先调 `guidance/evaluate` → 按 `decision` 行动 → 原样呈现文案 → 回传 `signal_id`/`action_id`。

### MCP bundle

```
mcp.json                       # 可直接合并进 MCP 客户端配置
guidance-policies/<id>.yaml    # 策略副本（可被 CLI 重新加载）
README.md                      # 工具表 + 契约摘要
```

`mcp.json`：

```json
{
  "mcpServers": {
    "guidance": {
      "command": "npx",
      "args": ["-y", "guidance-runtime", "mcp", "--policy", "./guidance-policies"],
      "env": { "GUIDANCE_ENGINE_VERSION": "0.1.0" }
    }
  }
}
```

## source_hash

每个 bundle 带一个 `source_hash`：策略集按 `id` 排序后 `sha256(stableStringify(policies))`。

用途：

- **同一个 hash 出现在三个目标里** → 三个 Agent 读的是同一份契约；
- 策略改动（哪怕只改 `priority`）→ hash 变化 → 可以判断某个 Agent 手里的产物是否过期。

测试：`tests/compile.test.ts` → "the source hash is identical across targets and stable across runs"

## 验收标准

> 给定同一条 `morning-focus-protection` 策略，编译命令能产出合法的 `AGENTS.md` 片段、`SKILL.md` 文件和可启动的 MCP Server；三者对同一模拟事件的求值结果一致。

一致性由两点保证：

1. 三种产物都从**同一个 `Policy` 对象**渲染，没有第二份事实来源；
2. MCP bundle 里的策略副本会被 `validatePolicyDocument` 重新校验（测试断言 round-trip 通过）。

## 命令

```bash
node dist/cli.js compile --policy packs/deep-work --out out --target all
node dist/cli.js compile --policy packs/deep-work --out out/agents-md --target agents
```

输出同时写 `out/compile-manifest.json`：引擎版本、`source_hash`、目标列表、策略 id、产物路径。
