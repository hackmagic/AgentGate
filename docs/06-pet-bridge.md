# 06 · 具身交互接口规范

宠物不是 Agent 的皮肤，是 `GuidanceSignal` 的具身呈现层。接口定义在引擎和宠物运行时之间，与具体宠物实现（dsh-pet / OpenPets / 其他）解耦。

## 引擎 → 宠物：`guidance_signal`

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

## 宠物 → 引擎：`guidance_response`

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

约束 1 与 2 由 `GuidanceEngine` 的速率闸与 `mute` 状态机实现；约束 4 由 `validateSignal`；约束 5 由「信号里根本没有生成入口」保证。

## HTTP 桥（`guidance pet`）

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

测试用 `X-Guidance-Now` 头覆盖服务端时钟：它同时决定求值时刻（`time_window` / `day_of_week`）、速率闸与过期判定，因此回放历史事件是可复现的。

## 接入 dsh-pet 的方式

利用其插件宿主的 `apply` 入口和 HTTP 路由表，把引擎的 `guidance_signal` 映射到宠物已有的气泡和动画池；不修改 dsh-pet 内核，只写适配插件。

最小适配器形状：

```ts
// 伪代码：dsh-pet 侧插件
import { apply } from 'dsh-pet/host';
import { PetBridgeClient } from 'guidance-runtime/pet';

apply((host) => {
  const client = new PetBridgeClient({ baseUrl: 'http://127.0.0.1:3778' });

  client.onSignal((signal) => {
    host.bubble.show(signal.presentation.bubble_text);
    host.animation.play(signal.presentation.animation_hint);
    host.buttons.render(signal.presentation.actions, async (actionId) => {
      await client.respond(signal.id, actionId);   // 只回传，不自行执行
    });
  });
});
```

关键点：**宠物不会自己去静音通知**。它把 `action_id` 回传，由用户态适配器（或 Agent 宿主）执行——引擎只记录决策与回执。

## 验收标准

> 手工触发一条 `require_approval` 策略，宠物弹出引导，用户批准后审计日志记录完整链路。

落点：`tests/pet.test.ts`

- `healthz` / `pending` 初始状态；
- 事件 → 信号 → `pending` 可见 → `approve` → `pending` 清空；
- `dismiss` 后同一策略不再重试（`throttled: true`）；
- 未知信号 404、坏 JSON 400、限流 429。
