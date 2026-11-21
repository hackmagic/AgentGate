---
title: "07 · 具身交互接口规范"
sidebar_position: 8
tags: [reference, embodiment]
description: "手工触发一条 require_approval 策略，宠物弹出引导，用户批准后审计日志记录完整链路。"
last_updated: 2026-11-22
translation_status: complete
---

# 07 · 具身交互接口规范

[English](../en/07-pet-bridge.md) | 中文

宠物不是 Agent 的皮肤，是 `GateSignal` 的具身呈现层。接口定义在引擎和宠物运行时之间，与具体宠物实现（dsh-pet / OpenPets / 其他）解耦。

## 引擎 → 宠物：`gate_signal`

```yaml
id: uuid
policy_id: string
decision: suggest | require_approval | suppress        # 注意：没有 allow
presentation:
  animation_hint: idle_shift | stretch | alert | thinking
  bubble_text: string          # ≤30 字符，来自策略
  actions:
    - label: 批准
      action_id: approve
    - label: 忽略
      action_id: dismiss
    - label: 静默 1 小时
      action_id: mute_1h
action:                        # 引擎声明的意图，不是已执行的动作
  type: suppress_notifications
  scope: [slack, mail]
  parameters: { duration_minutes: 50 }
escalation:
  after_minutes: 10
  action: remind_once
  decision: suggest
expires_at: ISO8601 | null
created_at: ISO8601
trigger_event_id: string       # 回溯用；不含任何窗口内容
audit_level: full | summary | none
```

Schema：`schemas/signal.schema.json`。不变量由 `validateSignal()` 在构建时强制：

- `bubble_text` ≤ 30 码点（CJK 算 1 个字符）；
- `decision: require_approval` 必须至少有一个非 `approve` 的动作（**必须能拒绝**）。

## 宠物 → 引擎：`gate_response`

```yaml
signal_id: uuid
action_id: approve | dismiss | mute_1h
responded_at: ISO8601
```

只有三个合法动作。宠物不能发明动作，也不能只回 `policy_id`——必须精确回一个已被呈现的 `signal_id`，否则引擎抛 `unknown_signal`。

## 交互约束（写死，防止宠物变成骚扰器）

1. 同一策略在 `escalation.after_minutes`（缺省 30 分钟）窗口内最多呈现一次；
2. 用户 `dismiss` 后不得自动重试；
3. 宠物不得在用户处于 `focus_block` 且未触发策略时主动弹出引导；
4. 所有 `require_approval` 信号必须包含至少一个「拒绝」动作；
5. 宠物动画和气泡文案**不得由 LLM 实时生成**，必须来自策略的 `presentation` 字段——保证可审计、可测试。

约束 1 与 2 由 `AgentGate` 的速率闸与 `mute` 状态机实现；约束 4 由 `validateSignal`；约束 5 由「信号里根本没有生成入口」保证。

## HTTP 桥（`gate pet`）

默认监听 `127.0.0.1:3778`，只绑回环地址。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/healthz` | `{status, engine_version, policy_count}` |
| `POST` | `/v1/events` | body `{event}`（也接受裸 event）；返回求值结果 |
| `GET` | `/v1/signals/pending` | 尚未回应的（未过期）信号 |
| `POST` | `/v1/signals/:id/respond` | body `{action_id, responded_at}` |

错误以 `{error: {code, message, retry_after_seconds?}}` 返回：

| 状态码 | 场景 |
| --- | --- |
| 400 | 事件/回执形状不合法、JSON 解析失败 |
| 404 | 未知 `signal_id`、或该信号未提供此动作 |
| 429 | 事件提交被限流（默认 60 次/分钟） |

测试用 `X-Agent-Gate-Now` 头覆盖服务端时钟：它同时决定求值时刻（`time_window` / `day_of_week`）、速率闸与过期判定，因此回放历史事件是可复现的。

## 接入宠物宿主

引擎自带客户端，适配器不必重新实现协议：

```ts
import { PetBridgeClient } from 'agent-gate/pet';

const client = new PetBridgeClient({ baseUrl: 'http://127.0.0.1:3778' });

// 每个 signal id 只触发一次，即使 bridge 每次轮询都返回同一条待处理信号。
const poller = client.onSignal({
  interval_ms: 1000,
  onSignal: (signal) => {
    show(signal.presentation.bubble_text);       // 策略文案，原样呈现
    render(signal.presentation.actions, (actionId) => client.respond(signal.id, actionId));
  },
});

// 稍后：poller.stop()
```

除非显式传 `allow_remote: true`，客户端拒绝非回环的 `baseUrl`。这个默认值是有意义的：
bridge 会下发审批请求，把适配器指向别人的主机应该是刻意行为，而不是端口打错。

### 已经交付的适配器

`integrations/dsh-agent-gate-pet/` 是一个可用的 DSH bundle，做的正是上面这件事：宿主半边把
bridge 代理成仅回环可访问的路由，浏览器半边在输入区停靠位渲染每条信号。它是独立 bundle，
不与任何宠物插件共享代码。

它**故意没有**塞进 `dsh-hackmagic-pets`：那个包渲染 3D 宠物，且不暴露气泡或动画钩子，
把适配器写进去意味着改动它预编译的 client bundle——那换个名字就是改宿主内核。

### 第二种具现层：OpenPets

`src/pet/openpets-adapter/` 面向 [OpenPets](https://docs.openpets.dev)——一个桌面伴侣应用，
有自己的一套集成契约。它是独立适配器而不是上面那个的变体，因为两个宿主在关键点上不同：
OpenPets 用租约路由宠物、接受封闭的 reaction 枚举而不是动画提示、并把语音限制在验证池里。

| 契约条款 | 这个适配器如何满足 |
| --- | --- |
| 配置可逆 | 带标记的条目、逐字节备份、拒绝覆盖他人文件 |
| 运行时 fire-and-forget | `dispatch()` 从不等待、从不抛出；失败落进 `stats()` |
| 语音始终安全 | 消息来自验证池，绝不来自 `bubble_text` |
| 租约路由宠物 | 15s TTL、心跳与过期 id 恢复、只释放一次 |

详细说明与失败状态见 `src/pet/openpets-adapter/README.md`；`tests/openpets.test.ts`
在没有运行中的应用的情况下证明上述四条。

```bash
node integrations/dsh-agent-gate-pet/test/verify-host.mjs
node integrations/dsh-agent-gate-pet/test/verify-client.mjs
```

示意代码与已交付的 bundle 都守着同一条关键点：**呈现层不会自己去静音通知**。它把
`action_id` 回传，由用户态适配器执行——引擎只记录决策与回执。

## 验收标准

> 手工触发一条 `require_approval` 策略，宠物弹出引导，用户批准后审计日志记录完整链路。

落点：`tests/pet.test.ts`、`tests/pet-client.test.ts`，以及
`integrations/dsh-agent-gate-pet/test/`

- `healthz` / `pending` 初始状态；
- 事件 → 信号 → `pending` 可见 → `approve` → `pending` 清空；
- `dismiss` 后同一策略不再重试（`throttled: true`）；
- 未知信号 404、坏 JSON 400、限流 429；
- 已交付适配器：每条路由都有回环栅栏、伪造的 action 在到达引擎之前就被拒绝、不可达的 bridge 渲染成状态而不是崩溃。
