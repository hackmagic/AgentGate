---
title: "08 · 安全与审计"
sidebar_position: 9
tags: [security, reference]
description: "权限分级、九字段审计白名单、否决权机制、威胁模型与明确不做的安全承诺。"
last_updated: 2026-11-22
---

# 08 · 安全与审计

中文 | [English](/en/08-security-and-audit)

## 权限分级（四级，默认最保守）

| 级别 | 含义 | 谁能触发 |
| --- | --- | --- |
| `read_only` | 只产出信号，不改变任何系统状态 | 所有策略默认 |
| `suggest` | 向用户提出建议，用户可忽略 | 策略显式声明 |
| `require_approval` | 需要用户明确批准才执行动作 | 策略显式声明 + 用户批准 |
| `autonomous` | 无需批准直接执行 | **MVP 不实现**：spec 保留字段但校验器拒绝 |

`autonomous` 的拒绝方式：任何 `requires_approval: false` 的策略必须给出 `rationale` 且不能 `audit_level: none`（`missing_rationale` / `unaudited_autonomy`）。

## 审计记录（白名单，九字段）

```text
event_id  policy_id  decision  signal_id  user_response
timestamp  engine_version  degraded  reason
```

`reason` 枚举：`matched` / `degraded` / `muted` / `rate_limited` / `user_approved` / `user_dismissed` / `user_muted`。

### 禁止出现在审计里的内容

- 屏幕截图、录屏帧
- 完整窗口标题（`secret.docx — Word`）
- 剪贴板内容
- 按键序列
- 文件路径（除 `policy_id` / 策略文件名这类配置路径）

这条约束由三层强制：

1. **构造期过滤**：`createAuditRecord()` 只拷贝白名单字段，输入里的 `window_title` 直接被丢弃；
2. **写入前断言**：`JsonlAuditStore.append()` 调 `assertAuditRecordSafe()`，越界字段抛 `unsafe_audit_record`；
3. **测试固定**：`tests/contract.test.ts` 主动注入 `screenshot` / `window_title` / `clipboard` 并断言被剥离。

写入路径只有一个：`src/gate/audit-stage.ts` 的 `append()`。审计是中间件链的最后一环，
它观察的是**降级之后**的最终决策——所以「被限流」和「被静音」也各有一行，不会因为
走了另一条代码路径而漏记。

## 用户否决权是核心安全机制

否决数据必须回流到策略引擎，用于：

- 自动 `mute`（连续 3 次 `dismiss`）；
- 向用户建议修订条件。

否决还会投影成策略的**生命周期状态**（[03-policy-lifecycle](03-policy-lifecycle.md)）：
用户一次点击不仅否决了这一次，还改变了这条策略之后的可见性与审计解释。

这是「AI 引导」区别于「AI 监控」的关键分界线：监控只收集行为，引导允许用户用一次点击否掉整个规则。

## 威胁模型

| 威胁 | 缓解 |
| --- | --- |
| 策略写错导致过度拦截 | 默认 `requires_approval: true`；求值出错降级 `allow` |
| 模型即兴生成文案造成误导 | 文案只能来自策略文件；signal 里没有生成入口 |
| 适配器越权执行 | 引擎不持有执行能力；执行必须在批准后由适配器做 |
| 审计泄露隐私 | 九字段白名单 + 构造期过滤 + 写入期断言 |
| 记录被篡改后重放 | MVP 不提供签名；JSONL 可直接 `git` 版本化，后续可加哈希链 |
| 事件洪泛 | 宠物桥 60 次/分钟限流；引擎侧速率闸限制同策略重复呈现 |

## 明确不做的安全承诺

- **不做内容审查**：我们不读取屏幕内容，因此也无法判断内容是否敏感。
- **不做沙箱**：策略引擎本身运行在用户权限下；它不是安全边界，架构边界才是。
- **不保证动作可撤销**：`reversible` 是策略声明的意图，撤销逻辑在适配器里。

诚实说明这些，比给一个虚假的「全链路安全」承诺更有用。
