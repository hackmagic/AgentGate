# Changelog

所有值得注意的变更都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [SemVer](https://semver.org/)。

## [Unreleased]

### 计划

- 更多策略包（`packs/late-night`、`packs/meeting-heavy`）
- npm 发布（`bin: gate`）
- 策略修订建议：连续 dismiss 后给出可采纳的条件改写

## [0.2.0] — 2026-11-22

### 破坏性变更

项目从 `guidance-runtime` 更名为 **AgentGate**。旧仓库已归档并指向此处。

| 旧 | 新 |
| --- | --- |
| 包名 `guidance-runtime` | `agent-gate` |
| CLI `guidance <cmd>` | `gate <cmd>` |
| MCP 工具 `guidance/evaluate` | `gate/evaluate` |
| MCP 工具 `guidance/list-policies` | `gate/list-policies` |
| MCP 工具 `guidance/audit-query` | `gate/audit-query` |
| MCP server name `guidance-runtime` | `agent-gate` |
| 类型 `GuidanceEvent` | `AgentEvent` |
| 类型 `GuidanceSignal` | `GateSignal` |
| 类型 `GuidanceResponse` | `GateResponse` |
| 类型 `GuidanceEngine` | `AgentGate` |
| 类型 `GuidanceError` | `AgentGateError` |
| 模块 `src/engine.ts` | `src/gate/` |
| HTTP 头 `X-Guidance-Now` | `X-Agent-Gate-Now` |
| 编译产物目录 `guidance-policies/` | `agent-gate-policies/` |
| 环境变量 `GUIDANCE_ENGINE_VERSION` | `AGENT_GATE_ENGINE_VERSION` |
| Schema `$id` `guidance-runtime.dev` | `agent-gate.dev` |

改名原因不是审美：`guidance` 在 AI 语境下已被占用，`runtime` 是通用后缀，两者叠加
让一个本来有明确内核的项目无法被搜索到。

### 新增

- **组合层中间件链**（`src/gate/`）。原来的 `engine.ts` 门面把求值、速率闸和审计揉在
  一起；现在拆成 `pipeline` + `throttle` + `inbox` + `audit-stage`，按注册顺序执行，
  顺序即语义，可整体替换（`GateOptions.stages`），并可观测（`AgentGate#pipeline`）。
- **策略生命周期**（`src/policy/lifecycle.ts`、`docs/03-policy-lifecycle.md`）。
  `draft → validated → active ⇄ muted → archived`，从审计日志投影而来，不维护第二份
  状态文件。新增 `gate lifecycle` 命令。
- **编译一致性校验**（`src/compile/verify.ts`、`docs/06-compiler-spec.md`）。
  双重检查：`source_hash` 证明同源，从产物**读回事实**证明无字段丢失。新增 `gate verify`
  命令；`gate compile` 在一致性失败时拒绝写出。
- **`COMPILE_FORMAT_VERSION`**：与引擎版本解耦的渲染契约版本，写进每个产物与 manifest。
- **`compile-manifest.json` 增加 `artifacts`**：逐目标、逐文件哈希，能回答「哪个产物过期了」。
- **文档索引**（`docs/README.md`）与 `validate-specs` 里的文档事实门禁：文档宣称的层级、
  生命周期状态、格式版本与一致性错误码必须与代码一致。
- 测试 65 → 92。新增 `tests/pipeline.test.ts`、`tests/lifecycle.test.ts`、`tests/parity.test.ts`。

### 修复

- **非法 `action_id` 会吞掉待办信号。** `respond()` 先 `take()` 再校验，导致用户屏幕上
  的信号被销毁后抛错。改为 peek → 校验 → take。
- **宠物桥临时端口不稳定。** 绑定 `port: 0` 时 OS 可能返回 fetch 规范禁用的端口
  （如 6666），Node 自己的 `fetch` 会拒绝连接，测试随机失败并显示 `bad port`。
  现在遇到禁用端口自动重试。

### 变更

- 文档重新编号为 00–09，拆成「运行时 / 生命周期 / 编译器」三份主文档：
  `03-policy-dsl.md` → `04-policy-dsl.md`，`04-event-spec.md` → `05-event-spec.md`，
  `05-compilation-model.md` → `06-compiler-spec.md`，`06-pet-bridge.md` → `07-pet-bridge.md`，
  `07-security-and-audit.md` → `08-security-and-audit.md`，`08-mvp-roadmap.md` → `09-mvp-roadmap.md`。
- `scripts/check-boundaries.mjs` 改查四层依赖，并禁止纯核心读系统时钟。
- CI 新增编译一致性、产物格式版本与生命周期投影三项端到端检查。

## [0.1.0] — 2026-11-21

首次实现（原名 `guidance-runtime`）。

- 五份契约 JSON Schema + 手写子集校验器
- 策略 DSL、条件求值、五条语义规则、静音状态机
- ActivityWatch 事件适配器
- 内容无关审计（内存 / JSONL，九字段白名单）
- 无状态 stdio MCP server（三个工具）
- 三目标编译（AGENTS.md / SKILL.md / MCP bundle）
- 宠物 HTTP 桥
