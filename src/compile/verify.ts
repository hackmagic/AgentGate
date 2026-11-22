import type { Policy } from '../policy/types.js';
import { validatePolicyDocument } from '../policy/validate.js';
import type { CompilationBundle } from './index.js';

/**
 * Compilation parity: read the emitted artifacts back and prove they still
 * describe the same policy set. See docs/zh-cn/06-compiler-spec.md.
 *
 * Two different guarantees, both needed:
 *
 * 1. **Identity** — every target reports the same `source_hash`. Catches a
 *    compiler that renders different inputs per target.
 * 2. **Fidelity** — the facts a reader can recover from each artifact
 *    (decision, approval requirement, copy) match the source policy. Catches a
 *    renderer that drops or mangles a field while keeping the hash.
 *
 * Round-tripping through the *emitted text* is deliberate: an in-memory
 * comparison would pass even if the renderer lost a field.
 */

/** The facts every target must agree on, per policy. */
export interface ArtifactFact {
  policy_id: string;
  decision: string;
  requires_approval: boolean;
  bubble_text: string | null;
}

export interface ParityIssue {
  target: string;
  code: string;
  message: string;
}

export interface ParityReport {
  ok: boolean;
  source_hash: string | null;
  format_version: string | null;
  /** Facts recovered per target, keyed by target name. */
  facts: Record<string, ArtifactFact[]>;
  issues: ParityIssue[];
}

/**
 * Verify a set of compiled bundles against the policies they came from.
 * Returns a report rather than throwing: CI wants every issue, not the first.
 */
export function verifyCompilation(policies: readonly Policy[], bundles: readonly CompilationBundle[]): ParityReport {
  const issues: ParityIssue[] = [];
  const facts: Record<string, ArtifactFact[]> = {};

  const expected = expectedFacts(policies);
  const hashes = new Set<string>();

  for (const bundle of bundles) {
    hashes.add(bundle.source_hash);
    const recovered = readBundleFacts(bundle, issues);
    facts[bundle.target] = recovered;

    // Every source policy must be represented exactly once in every target.
    const seen = new Set(recovered.map((fact) => fact.policy_id));
    for (const policy of policies) {
      if (!seen.has(policy.id)) {
        issues.push({
          target: bundle.target,
          code: 'missing_policy',
          message: `artifact set for "${bundle.target}" never mentions policy "${policy.id}"`,
        });
      }
    }

    for (const fact of recovered) {
      const want = expected.get(fact.policy_id);
      if (want === undefined) {
        issues.push({
          target: bundle.target,
          code: 'unknown_policy',
          message: `artifact set for "${bundle.target}" mentions unknown policy "${fact.policy_id}"`,
        });
        continue;
      }
      compareFact(bundle.target, want, fact, issues);
    }
  }

  if (hashes.size > 1) {
    issues.push({
      target: '*',
      code: 'source_hash_mismatch',
      message: `targets disagree on the compiled policy set: ${[...hashes].join(', ')}`,
    });
  }

  const formatVersions = new Set(bundles.map((bundle) => bundle.format_version));
  if (formatVersions.size > 1) {
    issues.push({
      target: '*',
      code: 'format_version_mismatch',
      message: `targets were rendered by different compiler formats: ${[...formatVersions].join(', ')}`,
    });
  }

  return {
    ok: issues.length === 0,
    source_hash: hashes.size === 1 ? ([...hashes][0] ?? null) : null,
    format_version: formatVersions.size === 1 ? ([...formatVersions][0] ?? null) : null,
    facts,
    issues,
  };
}

function expectedFacts(policies: readonly Policy[]): Map<string, ArtifactFact> {
  const map = new Map<string, ArtifactFact>();
  for (const policy of policies) {
    map.set(policy.id, {
      policy_id: policy.id,
      decision: policy.decision,
      requires_approval: policy.safety.requires_approval,
      bubble_text: policy.presentation?.bubble_text ?? null,
    });
  }
  return map;
}

function compareFact(target: string, want: ArtifactFact, got: ArtifactFact, issues: ParityIssue[]): void {
  if (want.decision !== got.decision) {
    issues.push({
      target,
      code: 'decision_drift',
      message: `policy "${want.policy_id}": artifact says decision "${got.decision}", source says "${want.decision}"`,
    });
  }
  if (want.requires_approval !== got.requires_approval) {
    issues.push({
      target,
      code: 'approval_drift',
      message: `policy "${want.policy_id}": artifact says requires_approval=${got.requires_approval}, source says ${want.requires_approval}`,
    });
  }
  if (want.bubble_text !== null && got.bubble_text !== want.bubble_text) {
    issues.push({
      target,
      code: 'copy_drift',
      message: `policy "${want.policy_id}": artifact copy ${JSON.stringify(got.bubble_text)} does not match source ${JSON.stringify(want.bubble_text)}`,
    });
  }
}

/** Recover facts from whichever artifact shape a target emitted. */
function readBundleFacts(bundle: CompilationBundle, issues: ParityIssue[]): ArtifactFact[] {
  switch (bundle.target) {
    case 'agents': {
      const file = bundle.files.find((entry) => entry.path === 'AGENTS.md');
      if (file === undefined) {
        issues.push({ target: 'agents', code: 'missing_artifact', message: 'no AGENTS.md in the agents bundle' });
        return [];
      }
      return readAgentsMd(file.content);
    }

    case 'skill': {
      const recovered: ArtifactFact[] = [];
      for (const file of bundle.files) {
        if (!file.path.endsWith('SKILL.md')) continue;
        const fact = readSkillMd(file.content, issues);
        if (fact !== null) recovered.push(fact);
      }
      return recovered;
    }

    case 'mcp': {
      const copies = bundle.files.filter((entry) => entry.path.startsWith('agent-gate-policies/'));
      const recovered: ArtifactFact[] = [];
      for (const file of copies) {
        let document: unknown;
        try {
          document = JSON.parse(file.content) as unknown;
        } catch {
          issues.push({
            target: 'mcp',
            code: 'unparsable_policy_copy',
            message: `${file.path} is not valid JSON`,
          });
          continue;
        }
        // The strongest possible check: the emitted copy must still validate.
        const validated = validatePolicyDocument(document, file.path);
        if (!validated.valid || validated.policy === null) {
          issues.push({
            target: 'mcp',
            code: 'invalid_policy_copy',
            message: `${file.path} does not round-trip through the policy validator: ${validated.issues
              .map((issue) => issue.code)
              .join(',')}`,
          });
          continue;
        }
        recovered.push({
          policy_id: validated.policy.id,
          decision: validated.policy.decision,
          requires_approval: validated.policy.safety.requires_approval,
          bubble_text: validated.policy.presentation?.bubble_text ?? null,
        });
      }
      return recovered;
    }

    default: {
      const exhaustive: never = bundle.target;
      issues.push({
        target: String(exhaustive),
        code: 'unknown_target',
        message: `no fact reader for target ${String(exhaustive)}`,
      });
      return [];
    }
  }
}

/**
 * AGENTS.md chapters are self-describing:
 *
 *   > 策略 `id` v1 · 优先级 80 · 源哈希 `abcdef123456`
 *   - 决策：`require_approval` — 必须先取得用户批准…
 *   - 需要用户明确批准后才能影响系统状态。
 *   - 气泡文案（固定，不得由模型即兴生成）：进入 50 分钟专注？
 */
export function readAgentsMd(content: string): ArtifactFact[] {
  const facts: ArtifactFact[] = [];
  for (const chunk of content.split(/\n(?=## )/)) {
    const id = /^> 策略 `([^`]+)` v\d+/m.exec(chunk)?.[1];
    if (id === undefined) continue;

    const decision = /^- 决策：`([^`]+)`/m.exec(chunk)?.[1] ?? null;
    const bubble = /^- 气泡文案（固定，不得由模型即兴生成）：(.+)$/m.exec(chunk)?.[1];
    const approvalLine = /^- (需要用户明确批准后才能影响系统状态。|不需要逐次批准)/m.exec(chunk)?.[1];

    facts.push({
      policy_id: id,
      decision: decision ?? 'unknown',
      requires_approval: approvalLine === '需要用户明确批准后才能影响系统状态。',
      bubble_text: bubble === undefined ? null : bubble.trim(),
    });
  }
  return facts;
}

/** SKILL.md carries the id in the heading and the decision in the instructions. */
export function readSkillMd(content: string, issues: ParityIssue[] = []): ArtifactFact | null {
  const id = /^策略 `([^`]+)` v\d+/m.exec(content)?.[1];
  if (id === undefined) {
    issues.push({ target: 'skill', code: 'unparsable_skill', message: 'SKILL.md does not state its policy id' });
    return null;
  }

  const decision = /^\s+- `([a-z_]+)` → /m.exec(content)?.[1] ?? null;
  const bubble = /^- 气泡文案（固定，不得由模型即兴生成）：(.+)$/m.exec(content)?.[1];
  const approvalLine = /^- (需要用户明确批准后才能影响系统状态。|不需要逐次批准)/m.exec(content)?.[1];

  return {
    policy_id: id,
    decision: decision ?? 'unknown',
    requires_approval: approvalLine === '需要用户明确批准后才能影响系统状态。',
    bubble_text: bubble === undefined ? null : bubble.trim(),
  };
}
