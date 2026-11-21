---
title: "09 · 路线图与验收"
sidebar_position: 10
tags: [roadmap]
description: "English(09-mvp-roadmap.md) | 中文"
last_updated: 2026-11-22
---

# 09 · 路线图与验收

[English](../en/09-mvp-roadmap.md) | 中文

状态：M0–M6 的**内核部分已落地**（v0.3.0）。下表用 ✅ / ⬜ 标注真实进度，不写愿景。

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

## M6 · 双语文档（已完成）

对齐参考 harness 的文档体系：

- ✅ 每份文档都成对：`&lt;name&gt;.md` 英文、`&lt;name&gt;.zh.md` 中文，各自在 H1 下链到另一边
- ✅ `npm run verify-i18n` 校验配对、互链与标题大纲一一对应
- ✅ 分段哈希记录在 `docs/i18n/pairs.json`：只改一边而不同步另一边，CI 会红，而不是留下半翻译页面
- ✅ `validate-specs` 额外断言文档宣称的事实仍然成立

## M7 · 开源发布（进行中）

已完成：

- ✅ README、五条策略的 `deep-work` 包、示例数据
- ✅ CI（typecheck / 架构检查 / 测试 / 规范校验 / 编译一致性 / 构建）
- ✅ MIT License
- ✅ CONTRIBUTING 与策略贡献模板（双语）

待办：

- ✅ 又两个策略包：`packs/health-break`、`packs/context-switch-guard`
- ⬜ npm 发布（`bin: gate`）
- ⬜ 策略修订建议：连续 dismiss 后给出「是不是条件太宽」的具体改法

## M8 · 报告（已完成）

- ✅ `gate report`：把 JSONL 审计日志聚合为汇总、生命周期分布、逐策略计数与发现项
- ✅ Markdown 输出（`--format markdown`，现为默认）外加 `--out` 与 `--title`：报告通常在它落地的
  地方被读，而不是在终端里
- ✅ 同一份 `Report` 对象两种渲染：`--format text` 给人看，`--format json` 给消费方
- ✅ `docs/10-report-spec.md`，每个发现项 code 都由 `validate-specs` 把关
- ✅ `gate lifecycle --archive &lt;id&gt;:&lt;reason&gt;`：`archived` 状态现在 CLI 可达

做这个功能时修掉一个真实缺陷：引擎会累计否决次数，但**从不写 `reason: muted`**，于是引擎内部
已静音的策略被投影成 `active`。`muted` 在 `AUDIT_REASONS` 和生命周期折叠里都有，却没有任何地方
发出它。现在有一个回归测试，用真实 gate 构建真实日志。

## M9 · 审计深度（已完成）

- ✅ 又两个包：`packs/health-break`（4 条）、`packs/context-switch-guard`（4 条）
- ✅ `npm run audit-schemas`：报告任何手写校验器未实现的 schema 关键字
- ✅ `tests/schema.test.ts`：每个已实现关键字一条行为断言，让「支持」是被证明的
- ✅ `docs/06-compiler-spec.md` §6 的 SKILL.md 最低可用性标准，由 `tests/skill.test.ts` 固定
- ✅ 宿主 frontmatter 限制（name ≤ 64、description ≤ 1024）写进 §6.3，并按 schema 自身极值强制——
  起因是一个合法的 64 字符 id 生成了 75 字符的名字
- ✅ `COMPILE_FORMAT_VERSION` 1 → 2，因为 skill 形状变了

这一批暴露了三个缺陷，全在「看起来已经完成」的东西里：

1. `return-to-focus` 被 `notify-free-deep-block` 永久遮蔽：同 trigger、优先级更高、窗口重叠。
   一条永远触发不了的策略，看起来像功能，行为像注释。`tests/packs.test.ts` 现在按每条策略自身
   的条件边界探测，确保它能真正开火。
2. SKILL.md 让模型把用户回执「通过运行时」回传，但 MCP 面**没有回执工具**。这条指令描述的是
   系统不具备的能力，模型要么失败，要么宣称一次从未发生的批准。skill 现在写真实宠物桥路由，
   并说明没有桥时该怎么做。
3. CI 里硬编码了 `编译格式 v1`；现在从 manifest 读 `format_version`，改格式不必动 workflow。

## 下一步优先级

按「社区能不能贡献」排序，而不是按技术趣味：

1. **策略模板库扩展**——贡献一条 YAML 策略的门槛远低于贡献一个捕获引擎；
2. **真实宠物适配器**——让第一条链路在真人桌面上跑起来；
3. ~~**策略修订建议**~~——已交付；剩下的是「分散形态」的建议，而那需要白名单里没有的审计数据。

## 验收清单（可复制进 PR 描述）

```text
[ ] npm run check 全绿
[ ] 新增/修改策略：npm run validate-specs 通过
[ ] 改动引擎：五条语义规则测试仍绿（tests/gate.test.ts）
[ ] 改动组合层：tests/pipeline.test.ts 仍绿
[ ] 改动生命周期：tests/lifecycle.test.ts 仍绿
[ ] 改动审计：tests/contract.test.ts 的注入测试仍绿
[ ] 改动编译：gate verify + tests/parity.test.ts 仍绿
[ ] 改动文档：npm run verify-i18n 通过，两种语言都已更新
[ ] 未新增捕获依赖（ActivityWatch / screenpipe 之外）
[ ] 未实现 autonomous 执行级别
[ ] 未在纯核心引入 I/O 或系统时钟（npm run lint 会拦）
```
