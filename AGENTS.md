# Project: agent-gate

## What this is

个人边界策略运行时。四层架构：事件适配 → 纯核心 → 组合层 → 表面层。
一条策略源编译成 AGENTS.md / SKILL.md / MCP bundle。
不造捕获器，不造记忆数据库。

## Before you code

- 读 `docs/04-policy-dsl.md` 的「语义规则」章节，那是硬约束
- 读 `docs/02-architecture.md` 的「关键架构约束」，违反会导致 PR 拒绝
- 改组合层（`src/gate/`）前读 `docs/02-architecture.md` 的「中间件链」一节：
  注册顺序即语义
- 改编译器前读 `docs/06-compiler-spec.md` 的一致性契约，然后跑 `gate verify`
- 策略引擎的任何改动必须先加单元测试，再改实现

## Commands

- build: `npm run build`
- test: `npm test`
- lint: `npm run lint`
- spec validate: `npm run validate-specs`
- all: `npm run check`
- compile parity: `node dist/cli.js verify --policy packs/deep-work`

## Code rules

- TypeScript strict mode, ESM, Node ≥ 20.11
- 策略求值是纯函数，不读写全局状态、不读系统时钟（注入 `Clock`）
- 审计日志字段白名单见 `docs/08-security-and-audit.md`，不得添加白名单外字段
- 契约使用 snake_case（`event_id` / `requires_approval`），与文档一致
- 新枚举值必须同时更新 `schemas/*.schema.json` 与 `src/**/types.ts`（`validate-specs` 会检查）
- 组合层新增副作用必须做成 `GateStage`，不要塞回 `AgentGate.evaluate()`
- 改编译产物形状必须 bump `COMPILE_FORMAT_VERSION`（`src/version.ts`）

## Boundaries

- 不要修改 `docs/` 下的 spec 文件来「让代码通过测试」——spec 是契约
- 不要引入新的捕获依赖（ActivityWatch / screenpipe 之外）
- 不要实现 `autonomous` 执行级别
- 引擎不得直接调用系统 API 执行动作，只产出 `GateSignal`
- 不要用 LLM 生成 `bubble_text` 或动画提示，只能来自策略
- 纯核心（`policy/`、`signal/`、`events/normalize`）不得 import 组合层或表面层

## Where things live

- 事件适配: `src/events/`
- 纯核心: `src/policy/`（含 `lifecycle.ts`）、`src/signal/`、`src/audit/`
- 组合层: `src/gate/`（pipeline + throttle + inbox + audit-stage）
- 宠物桥: `src/pet/`
- MCP: `src/mcp/`
- 编译器: `src/compile/`（含 `verify.ts` 一致性校验）
- 契约: `schemas/`
- 策略模板: `packs/*/policies/*.yaml`（`pack.yaml` 是清单，不是策略）
- 文档: `docs/`，先看 `docs/README.md` 的索引
