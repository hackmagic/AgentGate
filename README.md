# AgentGate

**把「AI 什么时候可以介入我电脑操作」写成可执行、可审计、可跨 Agent 复用的策略。**

你换工具（Cursor → Claude Code → Codex），边界就得重讲一遍。AgentGate 把这条边界
变成一份 YAML，编译成三种形态：`AGENTS.md` 片段、`SKILL.md` 技能、MCP Server 工具。
一样策略源，三个 Agent 读到同一条规则——这一点由 CI 里的一致性检查证明，不是口号。

```mermaid
flowchart LR
  AW[ActivityWatch / screenpipe] --> ADAPT[事件适配层]
  ADAPT -->|AgentEvent| GATE[AgentGate 组合层<br/>throttle → inbox → audit]
  GATE -->|GateSignal| PET[具身交互层]
  GATE -->|AuditRecord| AUDIT[(内容无关审计)]
  PET -->|gate_response| GATE
  GATE -->|编译| OUT[AGENTS.md / SKILL.md / MCP]
```

名字里的 **gate** 是字面意思：引擎只决定「这道门开不开」，不替你把门推开。

## 它不是什么

- 不是捕获器（不重造 ActivityWatch / screenpipe）
- 不是记忆数据库（不重造 Mem0 / Letta / Zep）
- 不是自动化执行器：没有 `autonomous` 级别，最高只到「需要用户批准」

## 60 秒上手

```bash
git clone https://github.com/hackmagic/AgentGate
cd AgentGate
npm ci
npm run build
```

校验内置策略包并查看一次真实决策：

```bash
node dist/cli.js validate packs/deep-work
node dist/cli.js list --policy packs/deep-work
node dist/cli.js evaluate --policy packs/deep-work \
  --event examples/focus-event.json \
  --now 2026-11-20T01:00:00Z --timezone Asia/Shanghai
```

输出（截断）：

```json
{
  "decision": "require_approval",
  "matched_policy_id": "morning-focus-protection",
  "signal": {
    "decision": "require_approval",
    "presentation": { "animation_hint": "alert", "bubble_text": "进入 50 分钟专注？" },
    "expires_at": "2026-11-20T01:50:00.000Z"
  }
}
```

把同一份策略编译给不同 Agent，并验证三份产物描述的是同一条规则：

```bash
node dist/cli.js compile --policy packs/deep-work --out out --target all
node dist/cli.js verify  --policy packs/deep-work
# out/AGENTS.md
# out/skills/agent-gate-<policy-id>/SKILL.md
# out/mcp.json + out/agent-gate-policies/*.yaml
```

启动 MCP server（无状态，每个请求自带事件）：

```bash
node dist/cli.js mcp --policy packs/deep-work --audit ./audit.jsonl
```

启动宠物桥（给任意呈现层对接）：

```bash
node dist/cli.js pet --policy packs/deep-work --audit ./audit.jsonl --port 3778
curl -s localhost:3778/healthz
curl -s -X POST localhost:3778/v1/events -H 'content-type: application/json' \
  -d @examples/pet-event.json
```

看一条策略现在处于什么状态：

```bash
node dist/cli.js lifecycle --policy packs/deep-work --audit ./audit.jsonl
# [{ "policy_id": "morning-focus-protection", "state": "active", "consecutive_dismissals": 1, ... }]
```

## 一条策略长什么样

`packs/deep-work/policies/morning-focus-protection.yaml`：

```yaml
policy:
  id: morning-focus-protection
  version: 1
  description: 工作日早上进入专注块时，先征得同意再静默非紧急通知
  priority: 80
  trigger:
    event: focus_block_started
    context:
      app: [code, cursor, terminal]
  conditions:
    all:
      - day_of_week: [mon, tue, wed, thu, fri]
      - time_window: "09:00-12:00"
  decision: require_approval
  action:
    type: suppress_notifications
    scope: [slack, mail, im]
    parameters:
      duration_minutes: 50
  safety:
    requires_approval: true
    reversible: true
    audit_level: full
```

五条语义规则（写在 [docs/04-policy-dsl.md](docs/04-policy-dsl.md)，由测试固定）：

1. `decision: suppress` + `requires_approval: true` 只能产出审批请求，**引擎不执行**
2. `requires_approval: false` 必须写明 `rationale`，并且不能 `audit_level: none`
3. 同一事件按 `priority` 降序求值，第一条非 `allow` 的策略终止求值
4. 任何策略求值出错 → 降级为 `allow`（不干预）并写审计
5. 连续 3 次 `dismiss` → 该策略静音，并建议用户修订

## 三个 Agent 工具

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `gate/evaluate` | `{ event }` | `{ decision, signal, matched_policy_id, degraded, throttled }` |
| `gate/list-policies` | `{}` | 策略摘要列表 |
| `gate/audit-query` | `{ since?, policy_id?, limit? }` | 内容无关的审计记录 |

MCP 版本 `2026-07-28`，无状态核心：`server/discover` 自描述，不需要握手期 session。

## 三件别人容易做漏的事

这三件事是这个项目和「一堆 if 判断」的区别所在。

**1. 组合层是可替换的中间件链，不是一个门面。**
求值是纯函数；速率闸、在途队列、审计是三个独立的 stage，按注册顺序跑。
`gate.pipeline` 把顺序暴露出来，`stages: [...]` 能把整条链换掉。详见
[docs/02-architecture.md](docs/02-architecture.md)。

**2. 策略有生命周期，且从审计日志投影出来。**
`draft → validated → active ⇄ muted → archived`。没有第二份状态文件可与实际行为漂移；
给定审计日志与 `now`，任何时刻都能重建当时的状态。详见
[docs/03-policy-lifecycle.md](docs/03-policy-lifecycle.md)。

**3. 编译一致性是可执行的检查，不是承诺。**
`source_hash` 只证明三份产物来自同一输入；`gate verify` 还会把产物**当文本读回来**，
逐条比对 decision / 审批立场 / 文案。丢字段的渲染器能通过 hash 检查，但过不了这一关。
详见 [docs/06-compiler-spec.md](docs/06-compiler-spec.md)。

## 审计边界

白名单九个字段，多一个都写不进去：

```
event_id policy_id decision signal_id user_response timestamp engine_version degraded reason
```

禁止：屏幕截图、完整窗口标题、剪贴板内容、按键序列。测试 `tests/contract.test.ts` 会尝试注入
`window_title` 并断言被丢弃。

## 目录结构

```
src/
  events/    事件适配层（ActivityWatch → AgentEvent）
  policy/    策略解析、条件求值、优先级、静音、生命周期、语义校验
  signal/    GateSignal 构建与不变量校验
  audit/     内容无关审计（内存 / JSONL）
  gate/      组合层：pipeline + throttle + inbox + audit-stage
  pet/       宠物桥（HTTP + 传输无关协议）
  mcp/       无状态 stdio MCP server
  compile/   策略 → AGENTS.md / SKILL.md / MCP bundle，含一致性校验
schemas/     五个契约 JSON Schema（policy/event/signal/audit/pet-contract）
packs/       策略模板库（社区贡献入口）
docs/        规范文档 00–09，索引见 docs/README.md
```

## 开发

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # 四层单向依赖检查 + 纯核心无时钟
npm test               # 单元与契约测试
npm run validate-specs # 代码常量 ↔ schema 枚举一致性
npm run build
npm run check          # 以上全部
```

## 设计取舍

- **策略是 YAML，不是代码**：非开发者也能贡献一条策略；贡献门槛决定社区规模。
- **引擎不执行动作**：只产出 signal。执行发生在适配器、且必须经过用户批准——
  这让「AI 引导」和「AI 监控」有了明确分界线。
- **文案不交给模型**：`bubble_text` 来自策略，可审计、可测试、可复现。
- **审计在默认路径上**：宁可多发一次审批请求，也不记录任何屏幕内容。
- **出错就放行**：宁可少引导，不可错误拦截。

## License

MIT
