---
title: "10 · 报告规范"
sidebar_position: 11
tags: [reference, report]
description: "本文件回答一个问题：gate report 到底算了什么，消费方可以依赖什么。"
last_updated: 2026-11-22
---

# 10 · 报告规范

中文 | [English](/en/10-report-spec)

> 本文件回答一个问题：**`gate report` 到底算了什么，消费方可以依赖什么**。
> 它读取的审计日志见 [08-security-and-audit](08-security-and-audit.md)；生命周期状态见
> [03-policy-lifecycle](03-policy-lifecycle.md)。

报告是**审计日志的投影**，与生命周期用的是同一套方法，本身不保存任何状态。它打印的每一个数字，
都能用同一份日志加同一个 `now` 重新算出来——这才是这些数字可信的原因，而不只是被持久化过。

## 1. 调用方式

```bash
gate report --policy packs/deep-work --audit ./audit.jsonl
gate report --policy packs/deep-work --audit ./audit.jsonl --out report.md
gate report --policy packs/deep-work --audit ./audit.jsonl --format json
gate report --policy packs/deep-work --audit ./audit.jsonl --format text
gate report --policy packs/deep-work --audit ./audit.jsonl --now 2026-11-20T05:00:00Z
gate report --policy packs/deep-work --audit ./audit.jsonl --no-policies
```

| 参数 | 含义 |
| --- | --- |
| `--policy <path>...` | 必填。报告**关于**哪份策略集；没有历史的策略会作为 `validated` 出现。 |
| `--audit &lt;file&gt;` | JSONL 审计日志。省略表示空日志，不是错误。 |
| `--format markdown\|text\|json` | `markdown`（默认）用于分享；`text` 用于终端；`json` 是稳定的机器形状。 |
| `--out &lt;file&gt;` | 把报告写进文件并打印路径，而不是输出到 stdout。 |
| `--title &lt;heading&gt;` | 仅 markdown：文档的 H1，默认 `AgentGate report`。 |
| `--now &lt;iso&gt;` | 有界静音到期判定与 `generated_at` 的参考时刻。 |
| `--no-policies` | 去掉逐策略表，保留汇总与发现项。 |
| `--archive &lt;id&gt;:&lt;reason&gt;` | 报告前应用一次操作者归档。 |
| `--rejection-threshold <0..1>` | 何时报 `high_rejection_rate`，默认 `0.5`。 |
| `--throttle-threshold &lt;n&gt;` | 何时报 `heavily_throttled`，默认 `3`。 |
| `--timezone &lt;tz&gt;` | IANA 时区，用于把否决时间分桶以生成修订建议。 |

只要生成了报告，退出码就是 `0`。**发现项是信息，不是失败**：某条策略被静音是用户的事实，
不是构建坏了。参数写错是 `2`；审计文件读不了才是错误。

### 报告从不写入审计日志

报告是**只读投影**。它打开审计文件、读、关掉，没有任何一条路径能让 `gate report` 追加记录。

这是硬规则而不是整洁偏好：一个既读又写的命令会改变自己下一次的输出。第二次运行会数进第一次
写下的行，数字会漂移，而用户看不到原因。`tests/report-render.test.ts` 断言报告前后审计文件
逐字节相同。

## 2. 格式：为什么默认是 markdown

报告通常在它落地的地方被读——issue、PR 评论、run summary——而不是在终端里滚过去。Markdown 正是
这些地方认识的语言，所以它是默认值。

它的形状由此决定：

| 选择 | 原因 |
| --- | --- |
| 真正的 `## Summary` 标题 | 评审者可以链到某一节 |
| 用表格，不用补齐空格的列 | 评论可以锚定到某条策略那一行 |
| 全篇表格 | 补齐空格的列在非等宽字体里会散架 |
| 正文不套代码围栏 | 围栏里的内容无法被评论，且换行难看 |
| 发现项 code 用 `` `code` `` 内联 | 稳定字符串可搜索，散文不可 |

`--format text` 留给终端——在那里对齐是优势，Markdown 是噪音。`--format json` 留给消费方——
在那里两者都不重要。

三种渲染读的是同一个 `Report` 对象，所以它们不可能在某个数字上互相矛盾。
## 3. 算了什么

每个计数都从 `AuditRecord.reason` 派生，所以只有一个事实来源：

| 字段 | 派生自 |
| --- | --- |
| `presented` | `reason: matched` 的记录——策略真的呈现给了用户 |
| `approved` | `reason: user_approved` |
| `dismissed` | `reason: user_dismissed` |
| `muted_short` | `reason: user_muted`（`mute_1h` 的有界窗口） |
| `throttled` | `reason: rate_limited`——匹配了，但还在呈现窗口内 |
| `degraded` | `reason: degraded`——见下面的归因规则 |

`events` 数的是**不同的 `event_id`**，不是记录数：一个事件可能产生多行。

### 两个比率，以及它们为什么可能是 `null`

```ts
approval_rate = approved / (approved + dismissed)
rejection_rate = dismissed / (approved + dismissed)
```

没人回答过时，两者都是 `null`。`null` 不是 `0`：「还没人决定」和「所有人都拒绝了」是相反的两个
发现，把它们压成 `0%` 是一个界面无法撤回的谎言。文本渲染打 `n/a`，JSON 打 `null`。

### 降级与归因

策略抛错时，引擎降级为 `allow`，并写一行 `policy_id: 'none'`。这是刻意的：把失败归到刚失败的
策略名下，等于信任那段刚刚出错的代码。

后果是逐策略的 `degraded` 列永远看不到这些行。所以：

- `summary.degraded` 数日志里所有降级行——始终准确；
- `policies[].degraded` 只数日志确实归给该策略的行。

这个不对称是有意的，写在这里而不是藏起来。汇总非零而逐策略全零，意思是「确实有失败，而引擎
拒绝猜是谁」。

## 4. 生命周期分布

`lifecycle` 数 [03-policy-lifecycle](03-policy-lifecycle.md) 里的五个状态：

```json
{ "draft": 0, "validated": 4, "active": 1, "muted": 0, "archived": 0 }
```

总和恒等于 `summary.policies`。`draft` 只能通过库 API（`authoringState`）到达，CLI 不可达——
因为 CLI 在加载前就拒绝了非法策略。

## 5. 发现项

发现项是派生出来的，从不存储。条件不成立时它自己就消失了。

| code | 何时报出 | 含义 |
| --- | --- | --- |
| `policy_never_presented` | 策略被求值过（被限流或降级）但从未 `matched`；或日志有历史但没有任何策略浮现 | 触发器太窄，或呈现窗口吞掉了每一次匹配 |
| `high_rejection_rate` | `rejection_rate >= 阈值` **且**至少 2 次否决 | 对这位用户来说条件多半太宽 |
| `muted` | 投影状态为 `muted` | 用户把它闭嘴了；有界静音会在消息里写明何时结束 |
| `degraded_evaluations` | 有降级行指到该策略 | 策略在抛错，条件需要修 |
| `heavily_throttled` | `throttled >= 阈值` | 匹配频繁但窗口太长 |

实现遵守两条规则，都是踩过坑之后定下来的：

1. **空日志不产生任何发现项。** 没有数据不是发现；报它只会训练人们忽略这一栏。
2. **报告能吐出的每个 code 都必须声明在 `FINDING_CODES`**，且 `validate-specs` 会断言它出现在
   本文档里。新发现项不可能不带文档上线。

## 6. 修订建议

**发现项**说哪里不对；**修订建议**说该改什么。两者分开，因为它们依据的证据不同，读者应当能只读其一就采取行动。

### 证据边界——在相信任何建议之前先读这段

`AUDIT_FIELD_WHITELIST` 是：`event_id`、`policy_id`、`decision`、`signal_id`、`user_response`、
`timestamp`、`engine_version`、`degraded`、`reason`。

它**不含事件上下文，也不含触发条件**。所以系统并不知道某次否决发生在开会时、在某个应用里、还是某个项目上。
任何暗示它知道的建议都是编的，而编出来的理由用户无法证伪。

日志里确实有的是——**什么时候**，而且很精确。这让一条主张站得住：

> **这些否决集中在策略当前覆盖的某个时段内。**

于是提出一个收窄 `time_window` 的方案。其他情况一律不给建议，因为诚实的回答是「证据不足以支持改动」，
而不是一个听起来合理的猜测。

### 窗口是怎么选出来的

| 步骤 | 规则 |
| --- | --- |
| 阈值 | 至少 3 次否决（可配置）才值得给建议 |
| 分桶 | 按 `--timezone` 时区把否决时间装进 2 小时桶，桶从整点 `00` 开始 |
| 锚点 | 桶不会在不同运行之间漂移，同一份日志的两次报告结论一致 |
| 窗口 | 取连续桶里覆盖最多的一段，只有严格变好才扩张 |
| 集中度 | 胜出的窗口必须容纳至少 60% 的否决，否则不给建议 |
| 收窄 | 打平时取更窄的窗口，因为建议的方向就是收窄 |

分散的否决（比如 03:00、10:00、15:00、21:00）**不会**产生建议。这种形态没有基于时间的改法，
硬给一个只会让用户去收窄一个改了也没用的窗口。

### 一条建议包含什么

```json
{
  "policy_id": "morning-focus-protection",
  "kind": "narrow_time_window",
  "summary": "3 of 3 answers were dismissals, 3 of them inside 10:00-12:00",
  "evidence": {
    "dismissals": 3,
    "approvals": 0,
    "buckets": [{ "window": "10:00-12:00", "dismissals": 3 }],
    "concentration": 1
  },
  "proposed_change": { "field": "time_window", "from": "09:00-12:00", "to": "10:00-12:00" },
  "caveats": ["…"]
}
```

策略没有声明 `time_window` 时 `proposed_change` 为 `null`：没有东西可收窄，所以只陈列证据、不给改法。
一个永远都有方案的建议器，等于一个不会说「不」的建议器。

`caveats` **永远非空**，且必定包含最要紧的那条：*日志记录的是否决发生在何时，不是为什么*。
小样本提示只在少于 5 次否决时出现——永远出现的提示等于没人看。

### Markdown 呈现

方案渲染成可直接套用的 diff，因为那才是用户能采取行动的形式：

````markdown
### `morning-focus-protection`

3 of 3 answers were dismissals, 3 of them inside 10:00-12:00

```yaml
time_window: "10:00-12:00"   # was: 09:00-12:00
```text

Caveats:

- The audit log records when a decision was dismissed, not why. …
````

### 建议故意不做的事

- **从不自动套用。** 建议是文本；改策略仍然是人的编辑。
- **从不使用白名单之外的数据。** 如果将来某个字段能让建议更好，那是
  [08](08-security-and-audit.md) 里的审计契约决策，不是这里的编译器决策。
- **从不冒充发现项。** 「采纳建议」和「消除发现项」是两个不同后果的动作。

## 7. JSON 形状

`--format json` 打印一个对象。消费方可以依赖下面的键，以及 `policies` 的顺序（与 `--policy`
加载顺序一致），但不要依赖对象内部的字段顺序。

```json
{
  "generated_at": "2026-11-20T05:00:00.000Z",
  "window": { "from": "2026-11-20T01:00:00.000Z", "to": "2026-11-20T01:30:00.000Z" },
  "summary": {
    "policies": 5,
    "policies_seen": 1,
    "events": 3,
    "presented": 3,
    "approved": 0,
    "dismissed": 3,
    "throttled": 0,
    "degraded": 0,
    "approval_rate": 0
  },
  "lifecycle": { "draft": 0, "validated": 4, "active": 0, "muted": 1, "archived": 0 },
  "policies": [
    {
      "policy_id": "morning-focus-protection",
      "state": "muted",
      "presented": 3,
      "approved": 0,
      "dismissed": 3,
      "muted_short": 0,
      "throttled": 0,
      "degraded": 0,
      "rejection_rate": 1,
      "consecutive_dismissals": 3,
      "muted_until": null,
      "first_seen": "2026-11-20T01:00:00.000Z",
      "last_seen": "2026-11-20T01:30:00.000Z"
    }
  ],
  "findings": [
    {
      "code": "high_rejection_rate",
      "policy_id": "morning-focus-protection",
      "message": "3 of 3 answers were dismissals; the condition is probably too broad"
    }
  ],
  "suggestions": [
    {
      "policy_id": "morning-focus-protection",
      "kind": "narrow_time_window",
      "summary": "3 of 3 answers were dismissals, 3 of them inside 10:00-12:00",
      "evidence": {
        "dismissals": 3,
        "approvals": 0,
        "buckets": [{ "window": "10:00-12:00", "dismissals": 3 }],
        "concentration": 1
      },
      "proposed_change": { "field": "time_window", "from": "09:00-12:00", "to": "10:00-12:00" },
      "caveats": ["…"]
    }
  ]
}
```

空日志时 `window` 为 `null`。没有记录的策略，`first_seen` / `last_seen` 为 `null`。

## 8. 稳定性承诺

| 承诺 | 含义 |
| --- | --- |
| 快照语义 | 同一份日志 + 同一个 `--now`，两次运行输出完全一致 |
| 只增字段 | 小版本可能新增键；已有键的含义不变 |
| 比率是 `null` 不是 `0` | 改这条就是破坏性变更 |
| 发现项是建议 | 它们从不改变退出码 |

不承诺：对象内部字段**顺序**，以及 `message` 的措辞。请解析稳定的 `code`，而不是用来给人读的散文。

## 9. 这份报告不是什么

- **不是健康检查。** 带发现项的报告就是一份正常报告。
- **不是隐私面。** 它只读九字段审计白名单，所以从结构上就无法泄露屏幕内容——靠的是设计，不是小心。
- **不能替代 lifecycle 命令。** `gate lifecycle` 看逐策略状态转换，`gate report` 看聚合。两个都要用。
- **不能替代 `gate audit`。** audit 命令按窄条件打印原始记录，report 把它们聚合。当某个数字看着不对时，
  回到 `gate audit` 逐行读。
