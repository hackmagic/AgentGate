# 00 · 一页纸立项

## 做什么

一个开源的**个人引导策略运行时**。把用户的操作习惯和边界编译成可跨 Agent 执行的引导策略，通过 AI 宠物等具身界面进行低打扰、可拒绝、可审计的交互。

一句话：**让「AI 什么时候可以介入我电脑操作」从口头约定变成可执行、可审计的策略文件。**

## 不做什么

同样重要，用于防止范围蔓延：

| 不做 | 原因 |
| --- | --- |
| 捕获器（ActivityWatch / screenpipe 重造） | 已有成熟工具；我们只定义语义超集 |
| 通用记忆数据库（Mem0 / Letta / Zep 重造） | 与「引导」正交，做了会稀释内核 |
| Web Dashboard / 团队版 / 非 Coding 场景 | MVP 之外，见 [08-mvp-roadmap](09-mvp-roadmap.md) |
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
| 3 | `src/pet/` + `tests/pet.test.ts` |
| 4 | `src/audit/store.ts` + `tests/engine.test.ts`、`tests/contract.test.ts` |

## 核心边界（不可交易）

- **引擎不执行动作**：只产出 `GateSignal`，执行发生在适配器且必须经用户批准。
- **审计不记内容**：只有九个白名单字段，没有窗口标题、截图、剪贴板、按键。
- **文案不生成**：`bubble_text` 来自策略文件，不由模型即兴创作。

## 谁是用户

已经在用 Coding Agent、但缺少「AI 什么时候可以介入我的电脑操作」边界控制的开发者与知识工作者。
