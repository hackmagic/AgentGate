# 06 · 编译器规范

[English](06-compiler-spec.md) | 中文

> 本文件回答一个问题：**一条策略凭什么能到处运行**。
> 运行时架构见 [02-architecture](02-architecture.zh.md)；生命周期见 [03-policy-lifecycle](03-policy-lifecycle.zh.md)。

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
| `format_version` | **渲染契约版本**（当前 `3`），与引擎版本解耦 |
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
本文件由 agent-gate v0.8.0 以编译格式 v3 从 5 条策略生成。…
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
      "env": { "AGENT_GATE_ENGINE_VERSION": "0.3.0" }
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
  "engine_version": "0.8.0",
  "format_version": "3",
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

## 6. 各目标的最低可用性标准

一致性（第 4 节）问的是产物彼此是否相符。可用性问的是另一个问题：**读者能不能真的照着它行事**。
一个能加载却无法照着做的产物，比没有更糟——读者会自己补上缺的那一步。

下面每条都由具名测试固定。`tests/skill.test.ts` 覆盖 skill 目标，其余在括号里注明。

### 6.1 所有目标

| 要求 | 原因 | 测试 |
| --- | --- | --- |
| 写明 `engine_version` 与 `format_version` | 读者必须能区分「产物过期」和「编译器更老」 | `tests/parity.test.ts` |
| 用 id 标识每条策略 | 不查源文件也能回答「这是哪条规则」 | `tests/skill.test.ts` |
| 同一输入产出确定的字节 | 两次编译必须逐字节一致，否则 `source_hash` 没有意义 | `tests/skill.test.ts` |
| 形状变化时 bump `format_version` | 静默的形状变更会破坏已经解析过它的读者 | `tests/parity.test.ts` + review |

### 6.2 `AGENTS.md`

| 要求 | 原因 |
| --- | --- |
| 一章一策略，标题用策略描述 | 策略变更必须能 diff 到 Agent 契约上 |
| 原样带上五条语义规则 | 这些规则约束的是**执行**，必须和指令放在一起 |
| 在禁止事项里写明 `requires_approval` | 这是执行者不能跨过的那条线 |

### 6.3 `SKILL.md`

这里门槛比另两个目标高，因为读 skill 的是一个模型——任何缺口它都会用一个看起来合理的猜测补上。

#### 宿主契约

读这个产物的是两类宿主：Agent Skills（Claude Code 及兼容宿主）与 OpenPets 的 agent 集成。
下面的限制取两者中更严的那一份。它们是硬限制：名字多一个字不是警告，是宿主直接拒绝加载。

| 字段 | 限制 | 由谁强制 |
| --- | --- | --- |
| `name` | ≤ **64** 字符，`^[a-z0-9]+(-[a-z0-9]+)*$`，且等于目录名 | `tests/skill.test.ts` |
| `name` | 不得含保留字（`claude`、`anthropic`） | `tests/skill.test.ts` |
| `description` | 1–**1024** 字符，非空，不得含 XML 标签 | `tests/skill.test.ts` |
| 正文 | 调用时才加载；短到能一口气读完 | review |

**名字上限与策略 schema 会撞车，而撞车处正是出问题的地方。** 策略 id 最长 64 字符。`agent-gate-`
前缀占 11 个，于是**一个 schema 认定的合法 id 生成了 75 字符的名字**——产物没有任何宿主愿意加载，
而输入在 schema 看来完全合法。

修复在 `skillName()` 里：超长 id 会被截断，并附上**原始 id** 的 8 字符摘要。摘要正是用来防止
两个共享前缀的长 id 塌缩成同一个 skill。`SKILL_NAME_MAX_LENGTH` 放在必须遵守它的代码旁边，
而不是藏在注释里。

#### 读者必须能做什么

| 要求 | 原因 | 缺了会怎样 |
| --- | --- | --- |
| `name` 等于目录名 | 宿主按目录索引，不一致会让 skill 变成孤儿 | 加载了但永远匹配不上 |
| `description` 同时写明 decision 与审批立场 | 列表视图必须够判断十条 skill | 读者只有撞上才知道有门槛 |
| 审批立场取自 `safety.requires_approval`，不取自 decision 词 | `suggest` 策略也可能需要审批 | 带门控的建议读起来像纯建议，就被那样对待了 |
| 立场只陈述**一次** | `decisionText('require_approval')` 本身已以审批句开头 | 两段拼起来像口吃，看起来像机器凑的 |
| 显式写出该策略自己的 `decision` | 模型不能靠猜自己在哪个分支 | 模型走错分支 |
| 列出全部 `action_id`，且不多列 | 用户只能用信号提供的动作回答 | 模型自造一个引擎会拒的 id |
| 回执路径指向**真实**端点 | MCP 无状态、没有回执工具；只有宠物桥接收回执 | 模型调用不存在的工具，或宣称已获批准 |
| 写明没有桥时该怎么做 | 这里一沉默，就会凭空产出「用户已批准」 | 审计里记下一次从未发生的同意 |

关于回执这条，值得用大白话再说一遍：**MCP 只有三个工具（`gate/evaluate`、`gate/list-policies`、
`gate/audit-query`），没有一个接收用户回执。** 一条写着「把答案通过刚才调用的工具回传」的 skill，
描述的是系统并不具备的能力。所以 skill 里写的是 `POST /v1/signals/{id}/respond`，并指示模型
在没有桥时报告「未回执」，而不是假定用户同意了。

#### 如何对照宿主契约验证

这些限制由 `tests/skill.test.ts` 固定，不靠 review。因为坏产物来自合法输入，测试直接用 schema
自己的极值来构造策略：

- 一个达到最大长度的策略 id；
- 两个共享前缀的长 id；
- 一条仍然要求审批的 `suggest` 策略。

产物的可信度，取决于我们**不只**检查了输入。
### 6.4 `MCP bundle`

| 要求 | 原因 |
| --- | --- |
| `mcp.json` 启动的命令在安装后真实存在 | 起不来的配置就是坏集成 |
| 策略副本能通过校验器 round-trip | bundle 必须可重新加载，不只是可读 |
| README 写明审批契约 | 集成方第一眼看到的就是它 |

### 6.5 故意不要求的

- **不规定散文长度。** 三条条件的策略和三十条条件的策略本就该长度不同，凑字数只会变成噪音。
- **不本地化 skill 正文。** 系统名词（`GateSignal`、`require_approval`、`action_id`）是契约词汇，
  在任何语言里都保持英文，见[文档索引](README.zh.md#翻译)。
- **不要求截图或动画素材。** 呈现是契约不是素材包；美术由具现层自己提供。

## 7. 版本兼容承诺

| 承诺 | 含义 |
| --- | --- |
| `format_version` 只增不改语义 | 同一 `format_version` 内，章节标题与字段位置稳定 |
| 未知字段被忽略，不报错 | 新增策略字段不破坏旧产物 |
| `source_hash` 算法不变 | 跨版本的 hash 保持可比 |
| 产物永远自描述 | 头部写明引擎版本与格式版本，不需要旁查 |

不承诺：**产物文本逐字节跨大版本稳定**。渲染是给人读的，标题措辞会随文档改进变化；
兼容性由 `format_version` 承载，不由字节承载。
