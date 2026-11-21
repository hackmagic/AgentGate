---
title: "05 · 行为事件规范"
sidebar_position: 6
tags: [reference, events]
description: "给定一份 ActivityWatch 导出 JSON，适配器能产出合法事件序列，且 focus_block_started 的判定规则有单元测试覆盖。"
last_updated: 2026-11-22
translation_status: complete
---

# 05 · 行为事件规范

[English](../en/05-event-spec.md) | 中文

这是源数据层的契约。不发明新捕获格式，只定义语义超集，兼容 ActivityWatch 和 screenpipe 的现有字段。

## 事件形状

```yaml
event:
  id: uuid                      # 缺省时由适配器生成
  type: focus_block_started     # 见下表
  timestamp: ISO8601
  source: activitywatch | screenpipe | manual
  context:
    app: string                 # 必填
    project: string | null
    language: string | null
  duration_seconds: number | null
  metrics: {}                   # 数值观测，如 focus_score
  metadata: {}                  # 适配器可放原始字段；引擎不得依赖
```

`metadata` 是逃生舱：适配器把 ActivityWatch 原始字段放这里，但**引擎永远不读它**。这样既能保留调试信息，又不会让策略悄悄依赖未规定的字段。

## 事件类型

| 类型 | MVP | 语义 |
| --- | --- | --- |
| `focus_block_started` | ✅ | 进入一段连续专注 |
| `focus_block_ended` | ✅ | 专注段结束 |
| `app_switch` | ✅ | 前台应用切换 |
| `idle_detected` | — | 人离开（AFK 超过阈值） |
| `interruption` | — | 被外部打断 |
| `notification_received` | — | 收到通知 |

后三种已进入 schema 与策略 DSL，适配器可以提前上报；只是 MVP 的内置适配器不生成它们。

## ActivityWatch 适配规则

入口：`eventsFromActivityWatch(input, options)`，接受 bucket 数组、`{ buckets: [...] }`、或单个 bucket。

| 参数 | 默认 | 语义 |
| --- | --- | --- |
| `focus_block_minutes` | 25 | 同一 app 的连续运行至少这么久才算专注块 |
| `gap_tolerance_seconds` | 120 | 相邻行间隔小于此值视为同一运行 |
| `idle_minutes` | 5 | AFK 行至少这么久才算 `idle_detected` |

产出规则：

1. 按 `timestamp` 排序 window 行，按 `app` 合并成 run（间隔 ≤ `gap_tolerance_seconds`）；
2. `app` 变化 → 产出 `app_switch`（`metadata` 带 `from_app` / `to_app`）；
3. run 时长 ≥ `focus_block_minutes` → 产出一对 `focus_block_started` / `focus_block_ended`，`duration_seconds` 是**整段块时长**；
4. AFK 行 `status: afk` 且时长 ≥ `idle_minutes` → `idle_detected`。

### project / language 提取

故意保守：**不确定就返回 `null`**，而不是猜一个可能悄悄放宽策略的值。

| 应用 | 规则 |
| --- | --- |
| VS Code 系（`Code`/`Cursor`/`Windsurf`/`VSCodium`） | 标题按 ` - ` 分段，≥3 段取倒数第二段 |
| 终端系（`Terminal`/`iTerm2`/`WezTerm`/`PowerShell`…） | 从标题里抓路径，取最后一段目录名 |
| 其他 | `null` |

`language` 由标题里的扩展名映射（`ts`→`typescript`、`rs`→`rust` …），无匹配则 `null`。

## 验收标准

> 给定一份 ActivityWatch 导出 JSON，适配器能产出合法事件序列，且 `focus_block_started` 的判定规则有单元测试覆盖。

落点：`tests/adapters.test.ts`

- 示例导出 → 7 条有序事件，字段逐个断言
- 两个 10 分钟 run 不构成 25 分钟专注块；调低阈值后合并
- 短 AFK 行被忽略
- 非 ActivityWatch 载荷 → `invalid_activitywatch_export`
- `normalizeEvent` 填补默认值、拒绝未知类型

## 与宠物 / MCP 的关系

事件是**引擎的输入**，不是宠物的输入。宠物只能看到 `GateSignal`；Agent 通过 MCP 的 `gate/evaluate` 提交事件。
这条边界防止宠物变成「直接监听原始行为的监控器」。
