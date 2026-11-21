---
title: "文档索引"
sidebar_position: 0
tags: [index]
description: "English(README.md) | 中文"
last_updated: 2026-11-22
translation_status: complete
---

# 文档索引

[English](../en/README.md) | 中文

三份主文档各回答一个问题，其余是契约附件。

| 文档 | 回答什么 | 何时读 |
| --- | --- | --- |
| [00 · 一页纸立项](00-project-brief.md) | 做什么、不做什么 | 第一次了解这个项目 |
| [01 · 产品需求](01-prd.md) | 为谁解决什么 | 判断某个需求在不在范围内 |
| [**02 · 运行时架构**](02-architecture.md) | **系统怎么跑** | 改代码前必读；含分层约束与中间件链 |
| [**03 · 策略生命周期**](03-policy-lifecycle.md) | **一条策略从生到死** | 贡献策略、排查「为什么它不弹了」 |
| [04 · 策略 DSL](04-policy-dsl.md) | 策略怎么写、五条语义规则 | 写策略、改求值器 |
| [05 · 行为事件规范](05-event-spec.md) | 引擎的输入长什么样 | 写适配器 |
| [**06 · 编译器规范**](06-compiler-spec.md) | **怎么保证到处运行一致** | 改编译器、判断产物是否过期 |
| [07 · 具身交互接口](07-pet-bridge.md) | 信号怎么呈现给用户 | 写宠物 / 悬浮层 |
| [08 · 安全与审计](08-security-and-audit.md) | 权限分级与审计边界 | 涉及隐私或执行能力时 |
| [09 · 路线图与验收](09-mvp-roadmap.md) | 已完成什么、下一步做什么 | 找可贡献的入口 |
| [10 · 报告规范](10-report-spec.md) | `gate report` 算了什么、消费方能依赖什么 | 基于报告输出做集成 |
| [术语表](glossary.md) | 项目术语的权威写法与含义 | 写任何页面，或翻译一页 |
| [参与翻译](contributing/translations.md) | 翻译流程、边界与评审标准 | 改动已翻译的页面 |

## 加粗的三份为什么单独存在

早期版本用一份 `02-architecture.md` 同时承担运行时、生命周期和编译规范，结果是三件事
互相稀释：读者找不到「一条策略被否决之后会怎样」，也找不到「编译产物凭什么可信」。

拆分的依据是**读者不同**：

- 改引擎的人读 02，需要的是层间契约与依赖方向；
- 写策略的人读 03 + 04，需要的是状态机与语义规则；
- 做集成的人读 06，需要的是产物形状与版本承诺。

## 文档即契约

`docs/` 下的规范文件不是描述性的，是可执行的：

| 文档 | 由什么固定 |
| --- | --- |
| 02 分层约束 | `npm run lint`（`scripts/check-boundaries.mjs`） |
| 03 生命周期规则 | `tests/lifecycle.test.ts` |
| 04 五条语义规则 | `tests/gate.test.ts`、`tests/policy.test.ts` |
| 05 事件规范 | `schemas/event.schema.json` + `npm run validate-specs` |
| 06 一致性契约 | `tests/parity.test.ts` + `gate verify` |
| 08 审计白名单 | `tests/contract.test.ts` + CI 断言 |

**不要为了让代码通过测试去改文档里的 spec。** spec 是契约，代码是实现；
两者冲突时先确认哪一边错了，而不是哪一边好改。
## 翻译

每份文档都是一对：`<name>.md` 是英文，`<name>.zh.md` 是中文。每页在 H1 下直接链到对应语言版本。
`npm run verify-i18n` 强制这层配对：

- 两边都存在，且互相链接；
- 标题大纲逐节对应，翻译不能悄悄少一节；
- `docs/i18n/pairs.json` 里记录的英文/中文分段哈希仍然匹配——只改一边而不同步另一边，CI 会红。

有意修改任何一边之后，用 `npm run verify-i18n -- --write` 重新记录。

代码块与标识符在两种语言里都保持英文：`GateSignal`、`require_approval`、`AGENTS.md` 是系统的专有名词，
翻译它们会破坏它们所指的契约。