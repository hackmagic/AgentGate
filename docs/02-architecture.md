# 02 · 架构

## 三层，严格单向依赖

```
┌──────────────────────────────────────────────┐
│  具身交互层（宠物 / 悬浮层 / CLI）             │
│  只消费 GuidanceSignal，不执行任何动作          │
├──────────────────────────────────────────────┤
│  引导策略引擎（核心）                          │
│  策略解析 → 条件求值 → GuidanceSignal          │
│  权限门控 + 审计日志                           │
├──────────────────────────────────────────────┤
│  事件适配层（ActivityWatch / screenpipe）      │
│  只做格式转换与字段补齐                        │
└──────────────────────────────────────────────┘
```

下层不知道上层的存在。这条约束由 `scripts/check-boundaries.mjs` 在 CI 中强制。

## 关键架构约束

违反任一条，PR 拒绝：

1. **策略引擎不得直接调用系统 API 执行拦截/抑制。** 它只产出 `GuidanceSignal`，由适配器（宠物或 Agent 宿主）在用户批准后执行。
2. **事件适配层不得包含任何策略逻辑。** 只做格式转换和字段补齐（`src/events/` 不 import `policy/`）。
3. **宠物层不得绕过策略引擎直接监听原始事件。** 它只能接收引擎产出的信号。
4. **审计日志不得包含原始屏幕内容或完整窗口标题。** 只记录 `event_id`、`policy_id`、决策结果等九个字段。
5. **纯函数核心**：`policy/conditions`、`policy/evaluate`、`signal/build` 不做 I/O、不读系统时钟（时钟由调用方注入）。

## 模块地图

| 模块 | 职责 | 允许依赖 |
| --- | --- | --- |
| `events/` | 规范化事件、ActivityWatch 适配 | `schema`、`util`、`errors` |
| `policy/` | 解析、条件求值、优先级、静音、语义校验 | `events/types`、`signal`、`schema`、`util` |
| `signal/` | 信号构建与不变量校验 | `policy/types`、`util` |
| `audit/` | 内容无关审计存储 | `schema`、`errors` |
| `engine.ts` | 有状态门面：求值 + 速率闸 + 审计 | 以上全部 |
| `pet/` | 宠物桥（HTTP / 传输无关） | `engine` |
| `mcp/` | 无状态 stdio MCP server | `engine` |
| `compile/` | 策略 → 三种 Agent 产物 | `policy`、`util` |

## 数据流

```
ActivityWatch 导出
      │  eventsFromActivityWatch()
      ▼
GuidanceEvent ──────────────────────────┐
      │  GuidanceEngine.evaluate()      │
      ▼                                 │
evaluateEvent()  ← 纯函数，按 priority  │
      │                                 │
      ├─ allow      → 无信号             │
      ├─ suggest / require_approval / suppress
      │        │                         │
      │        ▼                         │
      │  buildSignal() → GuidanceSignal  │
      │        │                         │
      │        ▼                         │
      │  宠物呈现 → guidance_response     │
      │        │                         │
      │        ▼                         │
      └─ applyResponse() → 静音状态 ─────┘
                 │
                 ▼
        AuditRecord（九字段）
```

## 技术选型

| 选择 | 理由 |
| --- | --- |
| TypeScript（ESM, strict） | 与 MCP 生态一致；类型即契约 |
| 单包、零运行时依赖（仅 `yaml`） | 安装体积小，供应链面窄 |
| 手写 JSON Schema 子集校验器 | 规则可审计，不引入 ajv 的隐式行为 |
| 纯函数求值 + 注入时钟 | 决策可复现，测试无需 mock 时间 |
| 内存 / JSONL 审计 | MVP 不需要数据库；JSONL 可直接 grep |
| 手写 CLI 参数解析 | 避免 commander/yargs 的版本漂移 |

## 为什么不把执行放进引擎

如果引擎能「直接执行」，那么每一个策略解析 bug 都会变成一次真实的系统变更。把执行推到适配器，并强制 `requires_approval`，意味着最坏情况只是「多问了一次用户」。

这是「AI 引导」与「AI 监控」的分界线，也是架构第一约束。
