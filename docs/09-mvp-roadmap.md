# 09 · 路线图与验收

状态：M0–M5 的**内核部分已落地**（v0.1.0）。下表用 ✅ / ⬜ 标注真实进度，不写愿景。

## M0 · 规范先行（已完成）

交付：

- ✅ 五份契约 JSON Schema（policy/event/signal/audit/pet-contract）
- ✅ 手写 schema 子集校验器 + 语义校验器（9 个错误码）
- ✅ `npm run validate-specs`：锁定「代码常量 ↔ schema 枚举」一致性
- ✅ 文档 00–09，拆成「运行时 / 生命周期 / 编译器」三份主文档 + 索引

验收：`npm run validate-specs` 全绿；spec 与代码漂移时 CI 红。

## M1 · 策略引擎 + ActivityWatch 适配器（已完成）

交付：

- ✅ 事件规范化与 ActivityWatch 适配器（focus block / app switch / idle）
- ✅ 条件求值（all/any/not、时区感知的 time_window、day_of_week、数值比较）
- ✅ 优先级求值、五条语义规则的实现
- ✅ 静音状态机（3 次 dismiss / mute_1h / approve 清零）
- ✅ 内容无关审计（内存 + JSONL）

验收：`npm test` 全绿，其中五条语义规则各有独立测试。

## M2 · MCP Server + 跨 Agent 编译（已完成）

交付：

- ✅ 无状态 stdio MCP server（`initialize` / `tools/list` / `tools/call` / `server/discover`）
- ✅ 三个工具：`gate/evaluate`、`gate/list-policies`、`gate/audit-query`
- ✅ 三目标编译（`AGENTS.md` / `SKILL.md` / MCP bundle）+ `source_hash` 一致性
- ✅ `compile-manifest.json`，含逐目标逐文件哈希

验收：`tests/compile.test.ts` + `tests/mcp.test.ts`；三产物 source_hash 相同。

## M3 · 宠物适配器（部分完成）

已完成：

- ✅ 传输无关的 `PetBridge` 协议
- ✅ HTTP 桥（`/healthz`、`/v1/events`、`/v1/signals/pending`、`/v1/signals/:id/respond`）
- ✅ 防骚扰约束：速率闸、dismiss 不重试、require_approval 必有拒绝动作
- ✅ 契约测试覆盖完整「呈现 → 批准 → 审计」链路
- ✅ 临时端口不再落在 fetch 禁用端口上（否则 Node 自己的 `fetch` 会拒绝连接）

未完成：

- ⬜ 真实 dsh-pet 插件（需宿主仓库；文档给的是适配器形状）
- ⬜ 宠物侧动画资源映射

## M4 · 分层重构（已完成）

「三层 flowchart」在实现上是一个门面，这是它最难拆的地方。本轮把它拆开：

- ✅ `src/engine.ts` 门面拆成 `src/gate/`：`pipeline` + `throttle` + `inbox` + `audit-stage`
- ✅ 中间件链可替换、可观测（`gate.pipeline`），顺序即语义
- ✅ `npm run lint` 强制新的四层依赖方向，纯核心禁止读系统时钟
- ✅ 修掉一个真实 bug：非法 `action_id` 会吞掉用户的待办信号

验收：`tests/pipeline.test.ts`（7 项），覆盖链顺序、链条替换、降级审计与信号存活。

## M5 · 生命周期与编译一致性（已完成）

- ✅ `src/policy/lifecycle.ts`：审计 → 生命周期投影（`draft/validated/active/muted/archived`）
- ✅ `gate lifecycle` 命令
- ✅ `COMPILE_FORMAT_VERSION` 与引擎版本解耦
- ✅ `src/compile/verify.ts`：身份（source_hash）+ 保真（从产物读回事实）双重校验
- ✅ `gate verify` 命令；`gate compile` 失败即中止
- ✅ 一致性错误码 10 个，各有测试

验收：`tests/lifecycle.test.ts`（11 项）+ `tests/parity.test.ts`（9 项）。

## M6 · 开源发布（进行中）

已完成：

- ✅ README、五条策略的 `deep-work` 包、示例数据
- ✅ CI（typecheck / 架构检查 / 测试 / 规范校验 / 编译一致性 / 构建）
- ✅ MIT License
- ✅ CONTRIBUTING.md 与策略贡献模板

待办：

- ⬜ 更多策略包（`packs/late-night`、`packs/meeting-heavy`）
- ⬜ npm 发布（`bin: gate`）
- ⬜ 策略修订建议：连续 dismiss 后给出「是不是条件太宽」的具体改法

## 下一步优先级

按「社区能不能贡献」排序，而不是按技术趣味：

1. **策略模板库扩展**——贡献一条 YAML 策略的门槛远低于贡献一个捕获引擎；
2. **真实宠物适配器**——让第一条链路在真人桌面上跑起来；
3. **策略修订建议**——利用生命周期数据，把 3 次 dismiss 变成一条可采纳的修改建议。

## 验收清单（可复制进 PR 描述）

```
[ ] npm run check 全绿
[ ] 新增/修改策略：npm run validate-specs 通过
[ ] 改动引擎：五条语义规则测试仍绿（tests/gate.test.ts）
[ ] 改动组合层：tests/pipeline.test.ts 仍绿
[ ] 改动生命周期：tests/lifecycle.test.ts 仍绿
[ ] 改动审计：tests/contract.test.ts 的注入测试仍绿
[ ] 改动编译：gate verify + tests/parity.test.ts 仍绿
[ ] 未新增捕获依赖（ActivityWatch / screenpipe 之外）
[ ] 未实现 autonomous 执行级别
[ ] 未在纯核心引入 I/O 或系统时钟（npm run lint 会拦）
```
