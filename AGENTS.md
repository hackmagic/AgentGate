# Project: agent-gate

## What this is

个人边界策略运行时。四层架构：事件适配 → 纯核心 → 组合层 → 表面层。
一条策略源编译成 AGENTS.md / SKILL.md / MCP bundle。
不造捕获器，不造记忆数据库。

## 文档在哪（先读这段）

中文是唯一真值源，英文是逐页镜像的翻译。**没有 `docs/*.md` 这种扁平文件**：

```
docs/
├── zh-cn/        真值源，写这里
├── en/           翻译，同名镜像
├── i18n/pairs.json  配对哈希（生成的，不要手改）
└── .vitepress/   文档站点配置
```

仓库根目录的 `README.md` / `CONTRIBUTING.md` 是中文，英文副本为 `*.en.md`。

## Before you code

- 读 `docs/zh-cn/04-policy-dsl.md` 的「语义规则」章节，那是硬约束
- 读 `docs/zh-cn/02-architecture.md` 的「关键架构约束」，违反会导致 PR 拒绝
- 改组合层（`src/gate/`）前读 `docs/zh-cn/02-architecture.md` 的「中间件链」一节：
  注册顺序即语义
- 改编译器前读 `docs/zh-cn/06-compiler-spec.md` 的一致性契约，然后跑 `gate verify`
- 改报告前读 `docs/zh-cn/10-report-spec.md` 的字段白名单与只读约束
- 策略引擎的任何改动必须先加单元测试，再改实现

## Commands

- build: `npm run build`
- test: `npm test`
- lint（架构边界）: `npm run lint`
- 文档格式: `npm run lint-docs`
- 双语文档配对: `npm run verify-i18n`
- spec 校验: `npm run validate-specs`
- schema 审计: `npm run audit-schemas`
- 文档站点: `npm run docs:build`
- 集成验证: `npm run verify-integrations`
- 全量: `npm run check`
- 编译一致性: `node dist/cli.js verify --policy packs/deep-work`

## Code rules

- TypeScript strict mode, ESM, Node ≥ 20.11
- 策略求值是纯函数，不读写全局状态、不读系统时钟（注入 `Clock`）
- 审计日志字段白名单见 `docs/zh-cn/08-security-and-audit.md`，不得添加白名单外字段
- 契约使用 snake_case（`event_id` / `requires_approval`），与文档一致
- 新枚举值必须同时更新 `schemas/*.schema.json` 与 `src/**/types.ts`（`validate-specs` 会检查）
- 组合层新增副作用必须做成 `GateStage`，不要塞回 `AgentGate.evaluate()`
- 改编译产物形状必须 bump `COMPILE_FORMAT_VERSION`（`src/version.ts`）
- 报告新增字段必须同步 `docs/*/10-report-spec.md`（`validate-specs` 会检查）

## Boundaries

- 不要修改 `docs/` 下的 spec 文件来「让代码通过测试」——spec 是契约
- 不要只改一边语言：内容变更先落 `docs/zh-cn/`，再同步 `docs/en/`
- 不要引入新的捕获依赖（ActivityWatch / screenpipe 之外）
- 不要实现 `autonomous` 执行级别
- 引擎不得直接调用系统 API 执行动作，只产出 `GateSignal`
- 不要用 LLM 生成 `bubble_text`、动画提示或报告建议文案，只能来自策略或固定模板
- 纯核心（`policy/`、`signal/`、`events/normalize`）不得 import 组合层或表面层
- 文档里的 `<placeholder>` 占位符必须写成 `&lt;placeholder&gt;`，否则站点编译失败

## Where things live

- 事件适配: `src/events/`
- 纯核心: `src/policy/`（含 `lifecycle.ts`）、`src/signal/`、`src/audit/`
- 组合层: `src/gate/`（pipeline + throttle + inbox + audit-stage）
- 报告: `src/report/`（build + render + suggest）
- 宠物桥: `src/pet/`（含 `openpets-adapter/`）
- MCP: `src/mcp/`
- 编译器: `src/compile/`（含 `verify.ts` 一致性校验）
- 宿主集成: `integrations/dsh-agent-gate-pet/`
- 契约: `schemas/`
- 策略模板: `packs/*/policies/*.yaml`（`pack.yaml` 是清单，不是策略）
- 文档: `docs/zh-cn/`，索引是 `docs/zh-cn/README.md`
