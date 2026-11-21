# Contributing

[中文](CONTRIBUTING.md) | English

The shortest and most effective contribution is **adding a policy**. Fixing the implementation comes
second.

## Add a policy (recommended)

1. Create `<your-policy-id>.yaml` under `packs/<pack>/policies/`;
2. Register it in the `policies:` list of `packs/<pack>/pack.yaml` (`validate-specs` checks that the manifest and the files agree);
3. Run `npm run validate-specs`;
4. Open a pull request stating: **what real irritation it solves**, and **why this `requires_approval` value is right**.

Template:

```yaml
policy:
  id: your-policy-id              # lowercase, hyphens
  version: 1
  description: One sentence on when it helps the user and with what
  priority: 50                    # higher wins; evaluated first when policies conflict
  trigger:
    event: focus_block_started
  conditions:
    all:
      - time_window: "09:00-12:00"
  decision: suggest               # suggest | require_approval | suppress | allow
  action:
    type: your_action_type
  safety:
    requires_approval: true       # should be true by default
    reversible: true
    audit_level: summary
  presentation:
    animation_hint: stretch
    bubble_text: One line under 30 characters
    actions:
      - label: OK
        action_id: approve
      - label: Ignore
        action_id: dismiss
```

### Adding a whole pack

A pack is a directory under `packs/` with a `pack.yaml` manifest listing its policy ids. The manifest
and the files must agree; `validate-specs` checks that, and `tests/packs.test.ts` additionally drives
every shipped policy to prove it can actually fire.

Two rules learned from building the bundled packs:

- **No policy may be permanently shadowed.** Two policies on the same trigger with overlapping
  conditions means the lower-priority one never runs; it looks like a feature and behaves like a
  comment. The test suite probes each policy at the edge of its own condition window and fails if a
  sibling always wins. Give them disjoint conditions (different day, hour, or duration floor) or delete
  the dead one.
- **A pack states its own boundary in `notes:`.** If it overlaps another pack, say which and why, so a
  reader enabling both knows which one speaks first.

### Policy review criteria

| Check | Requirement |
| --- | --- |
| Conservative by default | Prefer `require_approval` over `suppress` |
| Justify skipped approval | `requires_approval: false` needs a `rationale`, and cannot use `audit_level: none` |
| Refusal must be possible | A `require_approval` signal needs at least one non-`approve` action |
| Restrained copy | `bubble_text` ≤ 30 characters, plain language, no exclamation-mark cheerleading |
| No content reads | A policy must not depend on window title content, clipboard or keystrokes — the schema has no such fields |

## Change the implementation

```bash
npm ci
npm run check      # typecheck + architecture + tests + spec validation + build
```

Conventions:

- **Tests first**: the five semantic rules in `docs/04-policy-dsl.md` are hard constraints; changing the engine must keep their tests green;
- The pure core (`policy/conditions`, `policy/evaluate`, `signal/build`) performs no I/O and reads no system clock;
- New side effects in the composition layer belong in a `GateStage`, not inside `AgentGate.evaluate()`;
- Changing an artifact's shape requires bumping `COMPILE_FORMAT_VERSION` and updating `docs/06-compiler-spec.md`;
- A new enum value must change both `schemas/*.schema.json` and `src/**/types.ts` — `validate-specs` blocks changing only one;
- Do not edit a spec under `docs/` to make tests pass.

### Which layer does your change belong to

Decide the layer before writing code (`docs/02-architecture.md` has the four-layer table):

| You want to change | Go to | Do not touch |
| --- | --- | --- |
| Decision semantics | `src/policy/` | Do not import `gate/` |
| Rate limiting / queue / audit | `src/gate/` | Do not move decision logic in |
| Artifact rendering | `src/compile/` | Do not forget the fact readers in `verify.ts` |
| Presentation protocol | `src/pet/`, `src/mcp/` | Do not bypass composition to read events |

`npm run lint` rejects reverse dependencies, so this table is enforced rather than advised.

### Documentation changes are bilingual

Every document is a pair: `foo.md` (English) and `foo.zh.md` (Chinese). If you change one side, change
the other in the same pull request, then re-record:

```bash
npm run verify-i18n            # check
npm run verify-i18n -- --write # re-record after a deliberate edit
```

CI runs the check, so a one-sided edit fails instead of leaving a half-translated page. Section
headings must stay one-for-one; a translation does not get to drop a section.

## Commit messages

```
<type>(<scope>): <summary>

feat(policy): add late-night quiet pack
fix(gate): keep mute state across restarts
docs(spec): clarify time_window boundary
```

`type` ∈ `feat` / `fix` / `docs` / `test` / `refactor` / `chore`.

## Reporting a problem

Include: the policy YAML, the full `gate evaluate` output, and `node --version`.
Do **not** include real window titles or screenshot content — substitute placeholders when needed
(for example `a.docx — App` instead of `secret.docx — Word`).

## License

By contributing you agree to publish under the MIT license.
