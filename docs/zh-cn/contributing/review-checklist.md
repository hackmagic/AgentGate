---
title: "文档 PR 审核清单"
sidebar_position: 22
tags: [contributing, review]
description: "审核任何文档 PR（含 AI 生成）的清单。机械项由门禁覆盖，其余需要人读。"
last_updated: 2026-11-22
---

# 文档 PR 审核清单

中文 | [English](/en/contributing/review-checklist)

审核任何文档 PR 时对照本页，**包括 AI 生成的内容**。下面每一条都可核查；任何一条不通过，
请在合并前要求修改。

`npm run check` 覆盖其中的机械项：frontmatter、双树镜像、链接解析、标题漂移、代码块语言标注、
站点可构建。其余需要人读。

## 先跑门禁

```bash
npm run check        # 类型、架构、i18n、文档 lint、测试、规范、构建、集成
npm run docs:build   # 文档站点必须能构建
```

四项一旦失败，不必往下读——机械项已经拦住了。

## 分类

- [ ] 每页恰好属于一类：Tutorial / Guide / Reference / Contributing / Troubleshooting / Migration
- [ ] Tutorial 只含跑通首个 demo 所需的内容——不放参数枚举、不放完整 API 表
- [ ] Reference 是字典式的——不写长篇教程，该跳 Guide 就跳
- [ ] Guide 链接 Reference，而不是抄一遍参数
- [ ] Migration 按版本从新到旧，每条含影响范围、步骤与回滚

## 事实

- [ ] 每个参数、默认值、返回字段、错误码、命令都与源码或实际行为一致
- [ ] 没有编造内容；未验证的标 `Experimental` 或「待确认」
- [ ] 没有主观营销语（「强大」「最快」「推荐」），除非是在陈述事实
- [ ] 废弃内容写明 `Deprecated since vX.Y.Z`、移除版本与替代方案
- [ ] 实验内容说明不保证兼容、不建议用于生产

## Markdown 与站点

- [ ] 标题不跳级，全页只有一个 `#`
- [ ] 代码块都有语言标注
- [ ] 占位符写成 `&lt;name&gt;`，否则站点无法编译该页
- [ ] 站内链接是站点绝对路径（如 `/02-architecture`）；指向仓库根文件的用 GitHub 绝对 URL
- [ ] 图片有 alt 文本，且关键文字没有画进图里

## 翻译

翻译的完整规则见 [参与翻译](translations.md)。审核时只需确认：

- [ ] **中文是源**：内容变更先落在 `docs/zh-cn/`
- [ ] 两棵树页名一致，标题大纲逐节对应
- [ ] 标识符未翻译（`GateSignal`、`require_approval`、`action_id` 等）
- [ ] Warning / Caution 未删减或弱化
- [ ] 术语与 [术语表](../glossary.md) 一致
- [ ] `translation_status` 与事实相符（只有人工读过才可标 `complete`）

## 交付

- [ ] PR 标题以 `docs:` 开头
- [ ] 改动行为的代码变更与对应文档改动在同一个 PR
- [ ] 用户可见变更已同步 `CHANGELOG.md`
- [ ] 没有硬编码私有 IP、本地绝对路径、内部 URL
- [ ] 没有广告、无关推荐、非官方第三方链接

## AI 生成内容，额外确认

- [ ] 每条论断都能追到某个文件、某个测试或实际跑过的命令
- [ ] 局限被写成局限，而不是悄悄省略
- [ ] 随输出附一份自检结果，列出已验证项与仍未验证项

## 本页与其他页面的分工

本页只做**索引与判定**，规则本身写在各自的专题页里：

| 想知道什么 | 去哪 |
| --- | --- |
| 怎么翻译、边界在哪、评审标准 | [参与翻译](translations.md) |
| 术语的权威写法 | [术语表](../glossary.md) |
| 各页写什么内容、分层理由 | [文档索引](/index) |
