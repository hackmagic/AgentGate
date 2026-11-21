# Contributing

中文 | [English](CONTRIBUTING.en.md)

最短、最有效的贡献方式是**加一条策略**。其次是修实现。

## 加一条策略（推荐）

1. 在 `packs/<pack>/policies/` 新建 `<your-policy-id>.yaml`；
2. 在 `packs/<pack>/pack.yaml` 的 `policies:` 列表里登记它（`validate-specs` 会检查清单与文件是否一致）；
3. 跑 `npm run validate-specs`；
4. 提 PR，描述里写清：**它解决什么真实困扰**、**为什么这个 `requires_approval` 取值是对的**。

模板：

```yaml
policy:
  id: your-policy-id              # 小写、短横线
  version: 1
  description: 一句话说清它在什么情况下帮用户做什么
  priority: 50                    # 越大越优先；与其他策略冲突时先求值
  trigger:
    event: focus_block_started
  conditions:
    all:
      - time_window: "09:00-12:00"
  decision: suggest               # suggest | require_approval | suppress | allow
  action:
    type: your_action_type
  safety:
    requires_approval: true       # 默认就该是 true
    reversible: true
    audit_level: summary
  presentation:
    animation_hint: stretch
    bubble_text: 一句不超过 30 字的话
    actions:
      - label: 好
        action_id: approve
      - label: 忽略
        action_id: dismiss
```

### 贡献一整个策略包

包就是 `packs/` 下的一个目录，带一个 `pack.yaml` 清单列出它的策略 id。清单与文件必须一致，
`validate-specs` 会查；`tests/packs.test.ts` 还会把每条已发布策略真的驱动一遍，证明它能触发。

这两条规则是写内置包时踩出来的：

- **任何策略都不许被永久遮蔽。** 两条策略同一个 trigger、条件又重叠时，优先级低的那条永远不会运行：
  它看起来是个功能，行为像个注释。测试会按每条策略自身的条件边界去探测，只要有兄弟策略总能抢先就失败。
  要么把条件岔开（不同日期、时段或时长下限），要么删掉死的那条。
- **包要在 `notes:` 里说清自己的边界。** 与别的包重叠时写明是哪个、为什么，这样同时启用的人知道谁先说话。

### 策略评审标准

| 检查 | 要求 |
| --- | --- |
| 默认保守 | 能 `require_approval` 就不要 `suppress` |
| 免审批要说明 | `requires_approval: false` 必须写 `rationale`，且不能 `audit_level: none` |
| 一定可拒绝 | `require_approval` 的信号至少有一个非 `approve` 动作 |
| 文案克制 | `bubble_text` ≤ 30 字，说人话，不用感叹号堆情绪 |
| 不读内容 | 策略不得依赖窗口标题内容、剪贴板、按键——schema 里也没有这些字段 |

## 改实现

```bash
npm ci
npm run check      # typecheck + 架构检查 + 测试 + 规范校验 + 构建
```

约定：

- **先写测试**：`docs/04-policy-dsl.md` 的五条语义规则是硬约束，改引擎必须让对应测试继续绿；
- 纯函数核心（`policy/conditions`、`policy/evaluate`、`signal/build`）不许做 I/O、不许读系统时钟；
- 组合层新增副作用要做成 `GateStage`，不要塞回 `AgentGate.evaluate()`；
- 改编译产物形状必须 bump `COMPILE_FORMAT_VERSION`，并同步 `docs/06-compiler-spec.md`；
- 新枚举值必须同时改 `schemas/*.schema.json` 和 `src/**/types.ts`——`validate-specs` 会拦住只改一边的情况；
- 不要为了通过测试去改 `docs/` 里的 spec。

### 改动落在哪一层

改之前先确认代码属于哪一层（`docs/02-architecture.md` 有四层对照表）：

| 你想改 | 去哪 | 别碰 |
| --- | --- | --- |
| 决策语义 | `src/policy/` | 不要 import `gate/` |
| 限流 / 队列 / 审计 | `src/gate/` | 不要把决策逻辑搬进来 |
| 产物渲染 | `src/compile/` | 不要忘了 `verify.ts` 的事实读取器 |
| 呈现协议 | `src/pet/`、`src/mcp/` | 不要绕过组合层直接读事件 |

`npm run lint` 会拒绝反向依赖，所以这条表是强制的，不是建议。

### 文档改动必须双语

每份文档都是一对：`foo.md`（英文）和 `foo.zh.md`（中文）。改了一边，就在同一个 PR 里改另一边，然后重新记录：

```bash
npm run verify-i18n            # 检查
npm run verify-i18n -- --write # 有意修改后重新记录
```

CI 会跑这项检查，所以单边修改会直接失败，而不是留下一个只翻了一半的页面。章节标题必须一一对应：
翻译不能悄悄少一节。

## 提交信息

```
<type>(<scope>): <summary>

feat(policy): add late-night quiet pack
fix(engine): keep mute state across restarts
docs(spec): clarify time_window boundary
```

`type` ∈ `feat` / `fix` / `docs` / `test` / `refactor` / `chore`。

## 报告问题

请附上：策略 YAML、`gate evaluate` 的完整输出、`node --version`。
**不要**附真实窗口标题或截图内容——需要时用占位符（如 `secret.docx — Word` 替成 `a.docx — App`）。

## License

提交即同意以 MIT 许可发布。
