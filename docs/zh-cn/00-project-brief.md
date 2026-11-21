---
title: "00 · 一页纸立项"
sidebar_position: 1
tags: [overview]
description: "English(00-project-brief.md) | 中文"
last_updated: 2026-11-22
---

# 00 · 一页纸立项

[English](../en/00-project-brief.md) | 中文

## 做什么

一个开源的**个人引导策略运行时**。把用户的操作习惯和边界编译成可跨 Agent 执行的引导策略，通过 AI 宠物等具身界面进行低打扰、可拒绝、可审计的交互。

一句话：**让「AI 什么时候可以介入我电脑操作」从口头约定变成可执行、可审计的策略文件。**

## 不做什么

同样重要，用于防止范围蔓延：

| 不做 | 原因 |
| --- | --- |
| 捕获器（ActivityWatch / screenpipe 重造） | 已有成熟工具；我们只定义语义超集 |
| 通用记忆数据库（Mem0 / Letta / Zep 重造） | 与「引导」正交，做了会稀释内核 |
| Web Dashboard / 团队版 / 非 Coding 场景 | MVP 之外，见 [09-mvp-roadmap](09-mvp-roadmap.md) |
| `autonomous` 默认行为 | 默认永远是只读 / 建议 / 需审批 |

## 成功标准（MVP 验收）

1. 能从一条真实 ActivityWatch 事件生成一条可执行的引导策略；
2. 该策略能编译为 `AGENTS.md`、`SKILL.md`、`MCP Server` 三种形态中的至少两种；
3. 宠物能完成「提出引导 → 用户批准/拒绝 → 执行或静默」的完整交互；
4. 每一次引导都有审计记录，包含触发依据和用户否决。

四条标准在仓库中的落点：

| 标准 | 落点 |
| --- | --- |
| 1 | `src/events/activitywatch.ts` + `packs/deep-work/policies/*.yaml` + `tests/adapters.test.ts` |
| 2 | `src/compile/` + `tests/compile.test.ts` |
| 3 | `src/pet/` + `integrations/dsh-agent-gate-pet/` + `tests/pet.test.ts`、`tests/pet-client.test.ts` |
| 4 | `src/audit/store.ts` + `tests/gate.test.ts`、`tests/contract.test.ts` |

## 与初始愿景的取舍

本文档里的愿景并没有被逐字执行。凡是当前仓库与之不同的地方，这张表记录改了什么、为什么改、
代价是什么。**没写下来的取舍和「跑偏」在外部看来是一样的。**

| 初始愿景 | 现在仓库怎么做 | 为什么 | 代价 / 状态 |
| --- | --- | --- | --- |
| 项目叫 `guidance-runtime`，定位是「个人引导策略运行时」 | 改名 **AgentGate**；CLI 是 `gate`，信号是 `GateSignal` | `guidance` 在 AI 语境下已被占用，`runtime` 是通用后缀，名字既不承载定位也搜不到 | 一次性迁移成本：所有 import、工具名与契约名词都变了。见 [CHANGELOG](https://github.com/hackmagic/AgentGate/blob/main/CHANGELOG.md) |
| 三层：事件适配 → 策略引擎 → 具身交互 | **四层**：适配 → 纯核心 → 组合层（`src/gate/`）→ 表面层 | 「三层」只存在于图里；代码里求值、速率闸与审计被焊在一个 `engine` 门面里，是最难事后拆开的那种结构 | 多一个概念要学；换来每一环可单独替换、单独测试 |
| 策略就是一个引擎加载的 YAML 文件 | 策略还有**生命周期**（`draft → validated → active ⇄ muted → archived`），从审计日志投影而来 | 愿景说了「可拒绝、可审计」，但没说用户拒绝之后这条策略会怎样 | 多一份文档要读（[03](03-policy-lifecycle.md)）；没有第二份状态文件，所以没有新的漂移面 |
| 一条策略源编译成三种形态 | 仍是三种，外加**可验证的一致性契约**：`source_hash` **加上**从产物文本读回的事实 | 「到处能跑」如果不做检查就只是口号；而单靠哈希，一个悄悄丢字段的渲染器也能通过 | 编译需要每个目标的产物读取器；新增目标就要新增一个 |
| 文档 00–08，仅中文 | 文档 00–10，**双语**，每对由 `verify-i18n` 强制 | 代码、包元数据与 GitHub 都是英文；只有中文的 README 对从搜索进来的人是死路 | 每次改文档都是改两处，且由 CI 检查 |
| 策略语义写在签名与散文里 | 五条语义规则额外由测试与编译产物固定 | 只存在于散文里的规则，下一个贡献者一定会违反 | 编译器改动现在可能因语义规则而失败，而不只是拼写 |

### 尚未交付的愿景

这些是缺口，不是决策。写在这里是为了让 `docs/09-mvp-roadmap.zh.md` 保持诚实。

| 愿景 | 今天的事实 | 缺什么 |
| --- | --- | --- |
| 成功标准 3：「宠物完成 提出 → 批准 → 执行 全链路」 | 协议、HTTP 桥、客户端与一个已交付的 DSH 适配器都在；**「执行」这一步仍归适配器所有者**，且尚未在真实宿主里做过视觉验证 | 桌面通知面，以及一次真实宿主里的渲染走查 |
| 成功标准 1：「一条**真实**的 ActivityWatch 事件」 | 适配器吃的是**导出文件**（一段 JSON），从不连接运行中的 ActivityWatch | 实时采集器——而那是我们[刻意不做的](05-event-spec.md)；但「真实」需要说清楚 |
| 生命周期里的 `draft` 与 `archived` | `archived` 现在 CLI 可达（`gate lifecycle --archive`）；**`draft` 仍然只有库 API**，因为 CLI 在能报告它之前就拒绝了非法策略 | `draft` 不需要补：它描述的是「从未加载成功的文件」，读不了它的 CLI 也报不出它 |
| 可用 `npx agent-gate` 分发 | MCP bundle 的 `mcp.json` 已经在发 `npx -y agent-gate`，但包**尚未发布**到 npm | 一个发布步骤；在那之前这份生成的配置只是愿望 |

## 核心边界（不可交易）

- **引擎不执行动作**：只产出 `GateSignal`，执行发生在适配器且必须经用户批准。
- **审计不记内容**：只有九个白名单字段，没有窗口标题、截图、剪贴板、按键。
- **文案不生成**：`bubble_text` 来自策略文件，不由模型即兴创作。

## 谁是用户

已经在用 Coding Agent、但缺少「AI 什么时候可以介入我的电脑操作」边界控制的开发者与知识工作者。
