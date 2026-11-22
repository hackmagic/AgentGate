# Changelog

所有值得注意的变更都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [SemVer](https://semver.org/)。

## [Unreleased]

### 计划

- npm 发布（`bin: gate`）：需要 registry 凭据，`mcp.json` 里发出的 `npx -y agent-gate`
  在发布之前无法工作
- OpenPets 桌面端联调：mock IPC 无法证明的三项（窗口路由、租约到期销毁、App 端枚举校验）
  需要真机验证，见 `tests/pet-e2e-openpets.test.ts` 的 skip 说明
- 真实宿主里的渲染走查：`integrations/dsh-agent-gate-pet` 的结构验证已过，视觉验证未做

## [0.11.3] — 2026-11-22

### 修复

- **8 个页面的 frontmatter `description` 是语言切换行，不是摘要。**
  迁移脚本把「H1 之后的第一段」当描述提取，而有些页面 H1 后第一行就是
  `中文 | [English](…)`，于是 00/01/08/09 四个页面（双语共 8 个）的 SEO 摘要与
  搜索快照变成了 `English(01-prd.md) | 中文`。字段检查只看「是否存在」，全部通过——
  存在不等于形状正确。已逐页改写为真实摘要。
- **英文 roadmap 两行含字面量 `\n`。** 旧的 shell 替换残留，渲染后会把
  "…with the\n  evidence…" 当正文显示。已还原为真实换行。
- **roadmap 状态行落后两个大版本。** 还写着「M0–M6（v0.3.0）」，同一份文档的表格
  已经到 M9 / v0.11.2；同时 M7 待办里「策略修订建议」仍标 ⬜，而 M8 与优先级小节
  都记录它已交付。同一文档对同一功能给出两种结论。
- `lint-docs` 新增 `description` 形状规则（切换行、markdown 链接、复读标题都报错），
  已注入违规验证会拦。
- 新增 `npm run verify-roadmap`：roadmap 状态行的版本号必须等于 `ENGINE_VERSION`，
  声称覆盖到的里程碑必须与正文一致，⬜ 条目不得与 ✅ 条目撞车。已验证改旧版本号会红。

### 变更

- `npm run check` 从 12 项门禁增至 13 项（verify-roadmap）；`verify-ci-coverage`
  已确认 CI 矩阵 job 全部执行。

## [0.11.2] — 2026-11-22

### 修复

- **英文站顶部导航显示中文并链回中文树。** 根级 `themeConfig.nav` 会覆盖 `locales.<lang>` 里的配置，
  于是英文页的「Overview / Architecture / Policy DSL」全部指向中文页。已把 `nav` 从根级移除，
  只保留在各 locale 下。
- **侧边栏「文档索引」链接 404。** 侧边栏指向 `/README`，但站点把索引页服务于 `/`
  （`rewrites` 把 `README` 映射成 `index`）。构建本身不报错，只有点进去才会发现。
  两个语言的索引项都已改为 `/` 与 `/en/`。
- `lint-docs` 新增一条规则：**侧边栏链接必须对应真实页面**。侧边栏是手写的、不走链接解析，
  所以「构建成功 + 页面存在 + 链接 404」可以同时成立——这条规则正是为那次事故加的，
  并已验证它确实会拦住 `/README`。
- `lint-docs` 再增两条规则：**根级 `themeConfig.nav` 一律报错**（它会覆盖所有 locale），
  以及**英文导航不得离开 `/en/` 树**。两条都通过注入违规验证过。
## [0.11.0] — 2026-11-22

### 变更（破坏性：根目录文件名）

- **根目录文档也改为中文优先。** `README.md` 与 `CONTRIBUTING.md` 现在是中文，英文副本为
  `README.en.md` 与 `CONTRIBUTING.en.md`。至此全仓库方向一致：中文是唯一真值源。
  外部引用 `README.zh.md` / `CONTRIBUTING.zh.md` 的链接需要更新。

### 新增

- **GitHub Pages 部署**（`.github/workflows/docs.yml`）：`main` 上 `docs/**` 变更即构建并发布到
  https://hackmagic.github.io/AgentGate/ 。构建前跑 `verify-i18n` 与 `lint-docs`，翻译漂移会拦住部署
  而不只是拦住 PR。写入 `.nojekyll`，否则以 `_` 与 `.` 开头的资源会被 Jekyll 吞掉。
- **站点根路径可达**：中文树通过 `rewrites` 挂在站点根，`README` 映射为 `index`，因此
  `/AgentGate/` 有首页而不是 404。跨语言切换改用站点绝对路径，因为 rewrite 后文件路径与访问路径
  本就不同。
- `docs/*/contributing/review-checklist.md`（中英）：审核清单并入文档树，取代根目录的
  `docs-checklist.md`。该文件不再重复翻译规则，只做索引与判定。

### 修复

- `base` 设为 `/AgentGate/`，与 Pages 实际地址一致（仓库名大小写被 Pages 原样处理）。
- 两份 docs 索引的 `description` 曾被语言切换行污染，已改为实际描述。
## [0.10.0] — 2026-11-22

### 变更（方向反转）

- **文档改为中文优先。** `docs/zh-cn/` 是真值源，先写这里；`docs/en/` 是逐页镜像的翻译。
  `translation_status` 随之从中文页移到英文页。仓库根目录的 `README.md` 仍是英文（GitHub 访客先读它），
  `verify-i18n` 对这一例外有显式说明。
- 所有门禁的判定方向同步反转：`verify-i18n` 以中文为基准检测漂移，`lint-docs` 要求「源页不得有
  `translation_status`、翻译页必须有」。

### 新增

- **文档站点（VitePress 1.6.4）**：`docs/.vitepress/config.mjs`。中文挂根路径、英文在 `/en/`，
  侧边栏与框架文案（上一页/下一页、本页目录、搜索、主题）走 `locales` 配置而非正文。
  新增 `npm run docs:dev` / `docs:build` / `docs:preview`。
- `lint-docs` 新增两类站点渲染检查：未转义的 `<placeholder>` 占位符、指向文档根之外的相对链接。

### 修复

站点首次构建暴露的两个真实问题：

- **40 处 `<placeholder>` 被当作 HTML。** CommonMark 原样透传，Vue 报 "Element is missing end tag"，
  且错误指向无关行。已统一转义为 `&lt;...&gt;`（代码块内不动）。
- **4 个指向 `docs/` 之外文件的相对链接**在站点上下文里是死链，已改为 GitHub 绝对 URL。

### 依赖

- 新增开发依赖 `vitepress@1.6.4`（仅文档站点，不影响运行时零依赖）。
## [0.9.0] — 2026-11-22

### 变更（破坏性：文档路径）

- **文档目录改为 `docs/en/` + `docs/zh-cn/`**，两棵树页数、文件名、章节顺序完全一致。
  英文仍是唯一真值源。旧布局（同级 `foo.md` / `foo.zh.md`）在功能上等价，但不兼容 Crowdin / Weblate
  的目录约定，也无法被文档站点的多语言路由直接使用。
- 每页新增 frontmatter：`title`、`sidebar_position`、`tags`、`description`、`last_updated`；
  翻译页额外声明 `translation_status`（`complete` / `partial` / `todo`）。
- 语言切换从「同目录同名文件」改为「跨树相对路径」。

### 新增

- `docs/en/glossary.md` + 中文：术语表，统一 40 余个专有名词的写法与含义，并列出不翻译的标识符。
- `docs/en/contributing/translations.md` + 中文：翻译贡献指南，含流程、边界、评审清单、机翻规则。
- `docs-checklist.md`：文档 PR 人工审核清单，与机械门禁分工明确。
- **`npm run lint-docs`**（`scripts/lint-docs.mjs`）与 `npm run check` 联动，强制：frontmatter 完整性、
  单一 H1、标题不跳级、代码块必须有语言标注、无 CRLF / BOM、图片必须有 alt 文本、
  两棵树页码一致、`translation_status` 只在翻译页出现且取值合法。
- `validate-specs` 现在额外校验每页 frontmatter 字段与两树镜像。

### 修复

- 12 处代码块缺少语言标注（`text` / `bash` / `json` 等），已补。
- 3 个文件因编辑工具写入了 CRLF，已统一为 LF。
- 迁移后 4 个跨目录相对链接（指向 `CHANGELOG.md`、`CONTRIBUTING.md`）少了一层 `../`，已修正。
## [0.8.0] — 2026-11-22

### 新增

- **策略修订建议**：连续否决后，报告里给出一条具体的 `time_window` 收窄方案，连同支撑它的证据与
  限制它的 caveats（`docs/10-report-spec.md` §6）。`gate report` 新增 `--timezone`，因为分桶必须
  按策略窗口所在的时区来做。
- `tests/suggest.test.ts`（14 项）：证据边界、分散形态不给建议、无 `time_window` 时只给证据不给改法、
  caveats 非空且不误报。

### 设计约束（值得记住）

建议是**可证伪的**，这限制了它能说什么。审计白名单里没有事件上下文，也没有触发条件，所以唯一站得住的
信号是「什么时候」被否决。因此只提出收窄时段，其余情况一律不给建议——「证据不足以支持改动」比一个
用户无法证伪的合理猜测更有用。
## [0.7.0] — 2026-11-22

### 新增

- **SKILL.md 宿主契约校验**（`docs/06-compiler-spec.md` §6.3）。两类宿主（Agent Skills / OpenPets
  agent 集成）的硬限制现已写明并强制：`name` ≤ 64 字符、kebab-case、等于目录名、无保留字；
  `description` 1–1024 字符、无 XML 标签。
- `tests/skill.test.ts` 增加 6 项，直接用 schema 自己的极值构造策略来验证产物。

### 修复

- **合法策略会生成宿主拒绝加载的 skill 名。** 策略 id 上限 64 字符，`agent-gate-` 前缀占 11，
  于是 schema 认定的合法 id 生成 75 字符的名字——超出宿主 64 字符硬上限，任何宿主都不会加载。
  现在超长 id 截断并附**原始 id** 的 8 字符摘要，保证两个共享前缀的长 id 不会塌缩成同一个 skill。
- **frontmatter description 重复陈述审批立场。** `decisionText('require_approval')` 本身已以
  「必须先取得用户批准」开头，代码又拼了一次，输出成「…必须先取得用户批准，必须先取得用户批准」。

### 变更

- `COMPILE_FORMAT_VERSION` 2 → 3：SKILL.md 的 name 与 description 形状已变。
## [0.6.0] — 2026-11-22

### 新增

- **`gate report --format markdown`（新的默认格式）**，以及 `--out` 与 `--title`。报告通常落在
  issue、PR 评论或 run summary 里，所以输出是真正的 Markdown 文档：可链接的标题、可锚定的表格、
  不套代码围栏。`text` 与 `json` 保留给终端与消费方。
- `tests/report-render.test.ts`（11 项）：三种渲染的数字一致、markdown 不是套壳的文本表、
  空发现项写成 `None.`，并断言 `gate report` 前后审计文件**逐字节相同**。

### 变更

- `gate report` 默认格式从 `text` 改为 `markdown`；需要旧行为的脚本显式传 `--format text`。
## [0.5.0] — 2026-11-22

### 新增

- **OpenPets 适配器**（`src/pet/openpets-adapter/`）。面向 [OpenPets](https://docs.openpets.dev)
  桌面伴侣的第二种具现层，严格按它的四条集成契约实现：配置可逆、运行时 fire-and-forget、
  语音来自验证池、租约路由宠物。不改 OpenPets 内核，也不改任何宠物包。
- `tests/openpets.test.ts`（27 项）逐条证明四个契约条款，`tests/openpets-ipc.test.ts`（11 项）
  用**真实 socket** 验证线协议：请求字段、16KB 上限、超时、拒绝码、以及枚举外的 reaction 永不上线。

### 修复

- **备份回滚会改坏用户文件。** 「配置可逆」最初把邻居文件解析成对象再序列化回来，于是缩进、
  键间距与数字格式全被重写——那不是可逆，是「大致可逆」。现在备份保存原始文本，逐字节还原。
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
