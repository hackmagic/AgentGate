# 03 · 引导策略 DSL 规范

> 本文件是契约。实现必须遵守；测试必须固定这些规则。

DSL 借鉴 Cedar 的「二元决策 + 显式子句」风格，但面向个人引导场景重新设计为 YAML：
非开发者也能读、能改、能贡献。

## 完整字段

```yaml
policy:
  id: deep-work-protection          # ^[a-z0-9][a-z0-9._-]*$，≤64
  version: 1                        # 正整数
  description: 深度工作时段抑制非紧急通知
  priority: 100                     # 整数；越大越优先
  trigger:
    event: focus_block_started
    context:
      app: [code, cursor, terminal]
      project: [guidance-runtime]
      language: [typescript]
  conditions:                       # 可选；缺省视为「总是满足」
    all:
      - time_window: "09:00-12:00"
      - focus_score: "> 70"
      - day_of_week: [mon, tue, wed, thu, fri]
  decision: require_approval        # suggest | require_approval | suppress | allow
  action:
    type: suppress_notifications
    scope: [slack, discord, email]
    parameters:
      duration_minutes: 90
  escalation:
    after_minutes: 90
    action: suggest_break
    decision: suggest
  safety:
    requires_approval: true
    rationale: 静默通知会影响沟通           # requires_approval:false 时必填
    reversible: true
    audit_level: full                # full | summary | none
  presentation:
    animation_hint: alert            # idle_shift | stretch | alert | thinking
    bubble_text: 进入 50 分钟专注？   # ≤30 字符，按码点计
    actions:
      - label: 批准
        action_id: approve           # approve | dismiss | mute_1h
```

## 条件语法

条件是一棵树，三种组合子 + 叶子：

| 形式 | 语义 |
| --- | --- |
| `all: [...]` | 全部满足 |
| `any: [...]` | 任一满足 |
| `not: {...}` | 取反 |
| `{key: value}` | 叶子；同一叶子内多个 key 之间是「且」 |

叶子 key 的解析顺序：

| key | 语义 |
| --- | --- |
| `app` / `project` / `language` | 与事件 `context` 比较，大小写不敏感 |
| `time_window` | `HH:MM-HH:MM`，左闭右开，可跨午夜，按事件时区解释 |
| `day_of_week` | `mon..sun`（接受 `monday` 等全称） |
| 其他任意 key | 当作数值字段：先查 `event.metrics[key]`，再查 `duration_seconds`；支持 `> >= < <= = == !=` 字符串比较 |

未知字段**不匹配**并且产生一条 warning，而不是抛错——一个拼写错误不应该让引擎开始干预。

## 语义规则（硬约束）

### 规则 1：suppress 不能自己动手

`decision: suppress` 且 `requires_approval: true` 时，引擎只能产出 `GuidanceSignal(decision="require_approval")`，不得直接执行。

```ts
// src/policy/evaluate.ts
export function resolveDecision(policy: Policy): PolicyDecision {
  if (policy.decision === 'suppress' && policy.safety.requires_approval) return 'require_approval';
  return policy.decision;
}
```

测试：`tests/engine.test.ts` → "rule 1: suppress + requires_approval only ever asks"

### 规则 2：不要批准的策略必须解释自己

`requires_approval: false` 的策略必须在 `safety` 中显式声明 `rationale`，否则 spec 校验不通过。
同时禁止 `audit_level: none`：能自主行动的策略不能同时不可审计。

测试：`tests/policy.test.ts` → "rule: a policy that may act without approval needs a rationale"

### 规则 3：优先级降序，第一条非 allow 终止

同一事件下多条策略冲突时，按 `priority` 降序求值，第一条产出非 `allow` 决策的策略即终止。`priority` 相同时按 `id` 字典序，保证确定性。

测试：`tests/engine.test.ts` → "rule 3: highest priority wins…"

### 规则 4：出错就放行

任何策略求值出错时，默认降级为 `allow`（不干预），并记录审计。
**宁可少引导，不可错误拦截。**

测试：`tests/engine.test.ts` → "rule 4: a broken policy degrades to allow and is audited"

### 规则 5：连续否决即静音

用户对某条策略的否决连续出现 N 次（默认 3，可配置），引擎将该策略标记为 `muted`，并建议用户修订条件。

`dismiss` 累加计数；`approve` 清零；`mute_1h` 设置 60 分钟静默窗口但不改计数。

测试：`tests/engine.test.ts` → "rule 5: three consecutive dismissals mute the policy"

## 校验错误码

| code | 触发条件 |
| --- | --- |
| `missing_rationale` | `requires_approval: false` 却没写 `rationale` |
| `unaudited_autonomy` | `requires_approval: false` 且 `audit_level: none` |
| `approval_contradiction` | `decision: require_approval` 配 `requires_approval: false` |
| `allow_with_action` | `decision: allow` 却声明了 `action` |
| `missing_action` | `suppress` / `require_approval` 没有 `action` |
| `bubble_too_long` | `bubble_text` 超过 30 字符 |
| `duplicate_action` | `presentation.actions` 里重复的 `action_id` |
| `invalid_duration` | `duration_minutes` 非正数 |
| `invalid_version` | `version` 不是正整数 |

结构性问题由 JSON Schema 报出（`additionalProperties`、`required`、`enum`…），字段路径以 `/policy/...` 开头。

## 完整示例

见 `packs/deep-work/policies/`：五条覆盖四种 decision、审批与免审批、跨午夜窗口、数值条件、升级与静默。
