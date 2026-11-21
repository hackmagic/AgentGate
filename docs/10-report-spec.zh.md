# 10 · 报告规范

[English](10-report-spec.md) | 中文

> 本文件回答一个问题：**`gate report` 到底算了什么，消费方可以依赖什么**。
> 它读取的审计日志见 [08-security-and-audit](08-security-and-audit.zh.md)；生命周期状态见
> [03-policy-lifecycle](03-policy-lifecycle.zh.md)。

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
| `--audit <file>` | JSONL 审计日志。省略表示空日志，不是错误。 |
| `--format markdown\|text\|json` | `markdown`（默认）用于分享；`text` 用于终端；`json` 是稳定的机器形状。 |
| `--out <file>` | 把报告写进文件并打印路径，而不是输出到 stdout。 |
| `--title <heading>` | 仅 markdown：文档的 H1，默认 `AgentGate report`。 |
| `--now <iso>` | 有界静音到期判定与 `generated_at` 的参考时刻。 |
| `--no-policies` | 去掉逐策略表，保留汇总与发现项。 |
| `--archive <id>:<reason>` | 报告前应用一次操作者归档。 |
| `--rejection-threshold <0..1>` | 何时报 `high_rejection_rate`，默认 `0.5`。 |
| `--throttle-threshold <n>` | 何时报 `heavily_throttled`，默认 `3`。 |

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

`lifecycle` 数 [03-policy-lifecycle](03-policy-lifecycle.zh.md) 里的五个状态：

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

## 6. JSON 形状

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
  ]
}
```

空日志时 `window` 为 `null`。没有记录的策略，`first_seen` / `last_seen` 为 `null`。

## 7. 稳定性承诺

| 承诺 | 含义 |
| --- | --- |
| 快照语义 | 同一份日志 + 同一个 `--now`，两次运行输出完全一致 |
| 只增字段 | 小版本可能新增键；已有键的含义不变 |
| 比率是 `null` 不是 `0` | 改这条就是破坏性变更 |
| 发现项是建议 | 它们从不改变退出码 |

不承诺：对象内部字段**顺序**，以及 `message` 的措辞。请解析稳定的 `code`，而不是用来给人读的散文。

## 8. 这份报告不是什么

- **不是健康检查。** 带发现项的报告就是一份正常报告。
- **不是隐私面。** 它只读九字段审计白名单，所以从结构上就无法泄露屏幕内容——靠的是设计，不是小心。
- **不能替代 lifecycle 命令。** `gate lifecycle` 看逐策略状态转换，`gate report` 看聚合。两个都要用。
- **不能替代 `gate audit`。** audit 命令按窄条件打印原始记录，report 把它们聚合。当某个数字看着不对时，
  回到 `gate audit` 逐行读。
