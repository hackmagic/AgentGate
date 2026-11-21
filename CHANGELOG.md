# Changelog

所有值得注意的变更都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [SemVer](https://semver.org/)。

## [Unreleased]

### 计划

- 更多策略包（`packs/late-night`、`packs/meeting-heavy`）
- npm 发布（`bin: gate`）
- 策略修订建议：连续 dismiss 后给出可采纳的条件改写

## [0.4.0] — 2026-11-22

### 新增

- **两个策略包**：`packs/health-break`（久坐、用眼、深夜工作）、`packs/context-switch-guard`
  （误切换拦截、碎切换提示、上下文接续、深度块免打扰），各 4 条策略。
- **`npm run audit-schemas`**：审计 `schemas/*.schema.json` 用到的关键字与手写校验器的实现是否一致。
  手写子集的静默风险是「schema 用了没实现的关键字，那条约束就什么都不校验，而且没有任何测试会红」。
- **`tests/schema.test.ts`**：每个已实现关键字一条行为断言，让「支持」从声明变成证明。
- **SKILL.md 最低可用性标准**（`docs/06-compiler-spec.md` §6），由 `tests/skill.test.ts` 固定 11 项。
- **`tests/packs.test.ts`**：把每个包里的每条策略真的驱动一遍，含「不被永久遮蔽」的探测。

### 变更

- `COMPILE_FORMAT_VERSION` 1 → 2：SKILL.md 增加了回执路由一节，形状变了。
- CI 的格式版本检查改为从 manifest 读取，不再硬编码。

### 修复

- **SKILL.md 指示了一句做不到的事。** 它让模型把用户回执「回传给 `gate/evaluate` 所在运行时」，
  但 MCP 只有 `gate/evaluate`、`gate/list-policies`、`gate/audit-query` 三个工具，**没有回执入口**。
  模型要么调用不存在的工具，要么凭空宣称用户已批准——后者会写进审计，成为一次从未发生的同意。
  现在 skill 写明真实路由 `POST /v1/signals/{id}/respond`，并规定无桥时报告「未回执」。
- **`return-to-focus` 是条死策略。** 它与 `notify-free-deep-block` 同 trigger、优先级更低、窗口重叠，
  永远轮不到它。已把条件改到夜间窗口，并用探测测试防止同类问题复发。
## [0.3.0] — 2026-11-22

### 新增

双语文档体系，参照 DSH 的文档模型实现：

- 每份文档都是一对：`<name>.md`（英文）与 `<name>.zh.md`（中文），各自在 H1 下直接链到另一边。
  README、CONTRIBUTING、docs/00–09 与索引共 13 对。
- `npm run verify-i18n`（`scripts/verify-i18n.mjs`）校验四件事：两边都存在、互相链接、
  标题大纲逐节对应、所有相对链接可解析。
- `docs/i18n/pairs.json` 记录每一节英文/中文正文的哈希。**只改一边而不同步另一边，CI 会红**，
  而不是留下一个只翻了一半的页面。哈希范围排除代码块与语言切换行，所以代码与标识符
  在两种语言里保持英文也不会误报。
- 有意修改后可用 `npm run verify-i18n -- --write` 重新记录。
- `validate-specs` 现在断言每份文档两种语言都在、且 `docs/` 里没有未登记的散页。

### 变更

- 文档拆分方向反转：英文成为主文件（`foo.md`），中文迁移到 `foo.zh.md`。
  这是 DSH 的约定，也是开源项目更常见的默认。
- 英文文档为完整重写而非机器翻译，术语表固定：`GateSignal`、`require_approval`、`AGENTS.md`
  等作为系统专有名词在两种语言中都保持英文。
- 路线图新增 M6（双语文档），并把「文档改动」加进 PR 验收清单。

### 修复

- `docs/02-architecture.zh.md` 链接到不存在的 `04-policy-lifecycle.zh.md`（应为 `03-`）。
  这类错误现在由 `verify-i18n` 的相对链接检查拦下。

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
