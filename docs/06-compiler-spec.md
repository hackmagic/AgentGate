# 06 · 编译器规范

> 本文件回答一个问题：**一条策略凭什么能到处运行**。
> 运行时架构见 [02-architecture](02-architecture.md)；生命周期见 [03-policy-lifecycle](03-policy-lifecycle.md)。

一条策略源，编译成三种目标形态：`AGENTS.md` 片段、`SKILL.md` 技能、MCP bundle。
参考 transskill 的适配器模式：**源格式 → 目标适配器 → 输出**，不手写多份。

「一条策略到处运行」如果只是口号，它就是不可验证的营销。这一章定义四个可检查的
契约：**输入、输出、版本、一致性**。

## 1. 编译器输入

```ts
compilePolicies(policies: readonly Policy[], target: CompileTarget): CompilationBundle
```

- `policies` 是已经通过 `validatePolicyDocument()` 的策略对象数组，编译器不再做语义校验；
  它假设输入合法，并把非法输入当作调用方 bug（而不是在渲染时兜底）。
- 排序固定为 `id` 升序，保证两次编译的字节完全一致。
- 编译器是**纯函数**：不读文件、不读时钟、不生成随机 id。落盘由 `writeBundle()` 负责。

## 2. 编译器输出

每个 bundle 携带四个元数据字段：

| 字段 | 含义 |
| --- | --- |
| `target` | `agents` / `skill` / `mcp` |
| `engine_version` | 生成它的引擎版本（`0.1.0`） |
| `format_version` | **渲染契约版本**（当前 `1`），与引擎版本解耦 |
| `source_hash` | 策略集的 `sha256(stableStringify(sorted(policies)))` |

`files[]` 里每个文件带自己的 `sha256`，覆盖确切字节。这让「哪个产物过期了」可以逐文件回答，
而不是只能整包重编。

### format_version 是什么

引擎版本回答「谁生成的」，格式版本回答「读者该怎么解析」。两者必须分开：
修一个内部 bug 会让引擎版本变，但产物形状没变，已发布的 Agent 不需要重读；
反过来，改了一章的标题，引擎版本可能不变，但所有 Agent 都要重读。

**规则：只要某个目标的渲染形状变化到会让已发布的 Agent 读出不同含义，就 bump `format_version`。**
它定义在 `src/version.ts`，由 `tests/parity.test.ts` 断言与产物一致。

## 3. 目标格式矩阵

| 策略字段 | → `AGENTS.md` | → `SKILL.md` | → MCP bundle |
| --- | --- | --- | --- |
| `description` | 章节标题 | frontmatter `description` | bundle README 摘要 |
| `trigger` + `conditions` | 「何时适用」段落 | Instructions 里的条件描述 | `gate/evaluate` 的 `inputSchema` 约束 |
| `decision` + `action` | 「行为规则」段落 | Instructions 里的动作说明 | 返回值的 `decision` 字段 |
| `safety` | 「禁止事项」段落 | Instructions 里的边界 | `requires_approval` 元数据 |
| `presentation` | 「呈现」段落 | 呈现约束 | `signal.presentation` |
| `priority` | 头部元信息行 | — | 引擎内部求值顺序 |

### 三种产物的形状

**AGENTS.md** —— 一章一策略，便于把策略变更 diff 到 Agent 契约上：

```
# 个人引导策略（由 AgentGate 编译，请勿手改）
本文件由 agent-gate v0.1.0 以编译格式 v1 从 5 条策略生成。…
## 通用求值规则       ← 五条语义规则
## 边界               ← 执行者不是策略制定者
## {description}      ← 每条策略一章
   > 策略 `<id>` v1 · 优先级 80 · 源哈希 `abcdef123456`
   ### 何时适用 / ### 行为规则 / ### 禁止事项 / ### 呈现
```

**SKILL.md** —— 每个策略一个技能，目录 `skills/agent-gate-<policy-id>/SKILL.md`：

```yaml
---
name: agent-gate-morning-focus-protection
description: 工作日早上进入专注块时…（个人引导策略 morning-focus-protection：必须先取得用户批准）
---
```

正文 Instructions 明确四步：调 `gate/evaluate` → 按 `decision` 行动 → 原样呈现文案 →
回传 `signal_id` / `action_id`。

**MCP bundle**：

```
mcp.json                          # 可直接合并进 MCP 客户端配置
agent-gate-policies/<id>.yaml     # 策略副本（可被 CLI 重新加载）
README.md                         # 工具表 + 契约摘要
```

```json
{
  "mcpServers": {
    "agent-gate": {
      "command": "npx",
      "args": ["-y", "agent-gate", "mcp", "--policy", "./agent-gate-policies"],
      "env": { "AGENT_GATE_ENGINE_VERSION": "0.1.0" }
    }
  }
}
```

## 4. 一致性契约（这是重点）

一致性有两半，缺一不可。只做一半会产生一种很糟的假安全感。

### 4.1 身份：三个目标描述同一份策略集

`source_hash` 在三个目标里必须相同。它抓的是「编译器按目标渲染了不同输入」这类 bug。

### 4.2 保真：从产物里读回来的事实与源策略一致

光有 hash 不够：一个丢字段的渲染器可以保持 hash 不变（hash 算的是输入）。所以
`verifyCompilation()` 把产物**当文本读回来**，恢复四项事实，与源策略逐条比对：

| 事实 | 从哪读 |
| --- | --- |
| `policy_id` | `> 策略 \`<id>\`` / `策略 \`<id>\`` |
| `decision` | `- 决策：\`<decision>\`` / 指令列表项 |
| `requires_approval` | 安全性段落的第一句 |
| `bubble_text` | 「气泡文案（固定…）：…」 |

从**发出的字节**读，而不是比内存对象——这一点是刻意的：内存比对即使在渲染器丢字段时
也会通过。

```bash
gate verify --policy packs/deep-work          # 三个目标，全量
gate compile --policy packs/deep-work --out out --target all   # 编译内含校验，失败即中止
```

### 4.3 一致性错误码

| code | 触发条件 |
| --- | --- |
| `source_hash_mismatch` | 目标之间的 `source_hash` 不同 |
| `format_version_mismatch` | 目标之间由不同格式版本渲染 |
| `missing_policy` | 某条源策略在某个目标里消失了 |
| `unknown_policy` | 某个目标里出现了源策略集之外的 id |
| `decision_drift` | 产物里的 decision 与源策略不同 |
| `approval_drift` | 产物里的审批立场与源策略不同 |
| `copy_drift` | 产物里的文案与源策略不同 |
| `invalid_policy_copy` | MCP bundle 里的策略副本无法通过校验器 round-trip |
| `unparsable_policy_copy` | 策略副本不是合法 JSON |
| `missing_artifact` / `unparsable_skill` | 目标缺了关键产物，或产物无法解析 |
| `unknown_target` | 出现了没有事实读取器的目标（编译器新增目标但校验器未跟上） |

### 4.4 验收标准

> 给定同一条 `morning-focus-protection` 策略，编译命令能产出合法的 `AGENTS.md` 片段、
> `SKILL.md` 文件和可启动的 MCP Server；三者对同一模拟事件的求值结果一致。

在仓库里的落点：

| 断言 | 测试 |
| --- | --- |
| 三目标 `source_hash` 相同且稳定 | `tests/parity.test.ts` |
| 每个目标都能读回每条策略 | `tests/parity.test.ts` |
| 丢字段会被抓住 | `tests/parity.test.ts`（`approval_drift` 用例） |
| 少一条策略会被抓住 | `tests/parity.test.ts`（`missing_policy` 用例） |
| MCP 策略副本可 round-trip | `tests/parity.test.ts` + `tests/compile.test.ts` |
| AGENTS.md 与 SKILL.md 读出的事实相同 | `tests/parity.test.ts` |

## 5. 产物清单

```bash
gate compile --policy packs/deep-work --out out --target all
```

写 `out/compile-manifest.json`：

```json
{
  "engine_version": "0.1.0",
  "format_version": "1",
  "source_hash": "…",
  "targets": ["agents", "skill", "mcp"],
  "policies": ["evening-quiet-hours", "…"],
  "files": ["AGENTS.md", "mcp.json", "skills/agent-gate-…/SKILL.md"],
  "artifacts": [
    { "target": "agents", "source_hash": "…", "files": [{ "path": "AGENTS.md", "sha256": "…" }] }
  ]
}
```

`artifacts` 让消费方能判断**具体哪个产物**过期，而不是只知道整包变了。

## 6. 版本兼容承诺

| 承诺 | 含义 |
| --- | --- |
| `format_version` 只增不改语义 | 同一 `format_version` 内，章节标题与字段位置稳定 |
| 未知字段被忽略，不报错 | 新增策略字段不破坏旧产物 |
| `source_hash` 算法不变 | 跨版本的 hash 保持可比 |
| 产物永远自描述 | 头部写明引擎版本与格式版本，不需要旁查 |

不承诺：**产物文本逐字节跨大版本稳定**。渲染是给人读的，标题措辞会随文档改进变化；
兼容性由 `format_version` 承载，不由字节承载。
