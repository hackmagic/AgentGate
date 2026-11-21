import { ContractError } from '../errors.js';
import { loadSchema } from '../schema/load.js';
import { validateSchema } from '../schema/validator.js';
import { charLength } from '../util/text.js';
import { AUDIT_LEVELS, POLICY_DECISIONS, type Policy } from './types.js';

export interface PolicyIssue {
  /** JSON pointer into the document, e.g. `/policy/safety/rationale`. */
  path: string;
  /** Stable machine-readable code; schema keywords double as codes. */
  code: string;
  message: string;
}

export interface PolicyValidationResult {
  valid: boolean;
  issues: PolicyIssue[];
  policy: Policy | null;
}

/**
 * Validate a policy document against the JSON Schema *and* the semantic rules
 * from docs/04-policy-dsl.md. Schema alone cannot express rules such
 * as "a policy without approval needs a rationale".
 */
export function validatePolicyDocument(input: unknown, source = 'policy'): PolicyValidationResult {
  const document = wrapDocument(input, source);
  const schemaResult = validateSchema(document, loadSchema('policy'));

  const issues: PolicyIssue[] = schemaResult.issues.map((issue) => ({
    path: issue.path,
    code: issue.keyword,
    message: issue.message,
  }));

  if (!schemaResult.valid) return { valid: false, issues, policy: null };

  const policy = (document as { policy: Policy }).policy;
  issues.push(...checkSemantics(policy));
  if (issues.length > 0) return { valid: false, issues, policy: null };
  return { valid: true, issues: [], policy };
}

/** Accept either the canonical `{ policy: … }` wrapper or a bare policy body. */
function wrapDocument(input: unknown, source: string): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ContractError('invalid_policy_document', `${source}: expected a policy mapping`);
  }
  const record = input as Record<string, unknown>;
  if ('policy' in record) return record;
  return { policy: record };
}

function checkSemantics(policy: Policy): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const add = (path: string, code: string, message: string): void => {
    issues.push({ path: `/policy${path}`, code, message });
  };

  const safety = policy.safety;
  if (safety.requires_approval === false) {
    if ((safety.rationale ?? '').trim() === '') {
      add('/safety/rationale', 'missing_rationale', 'requires_approval: false needs a non-empty safety.rationale');
    }
    if (safety.audit_level === 'none') {
      add('/safety/audit_level', 'unaudited_autonomy', 'a policy that can act without approval must be audited');
    }
  }

  if (policy.decision === 'allow' && policy.action !== undefined) {
    add('/action', 'allow_with_action', 'decision: allow must not declare an action');
  }

  if (policy.decision === 'require_approval' && safety.requires_approval === false) {
    add(
      '/safety/requires_approval',
      'approval_contradiction',
      'decision: require_approval cannot be paired with safety.requires_approval: false',
    );
  }

  if ((policy.decision === 'suppress' || policy.decision === 'require_approval') && policy.action === undefined) {
    add('/action', 'missing_action', `decision: ${policy.decision} needs an action so the user knows what would happen`);
  }

  const bubbleText = policy.presentation?.bubble_text;
  if (bubbleText !== undefined && charLength(bubbleText) > 30) {
    add('/presentation/bubble_text', 'bubble_too_long', 'bubble_text must be at most 30 characters');
  }

  const actions = policy.presentation?.actions;
  if (actions !== undefined) {
    const seen = new Set<string>();
    actionLoop: for (const [index, action] of actions.entries()) {
      if (seen.has(action.action_id)) {
        add(`/presentation/actions/${index}/action_id`, 'duplicate_action', `duplicate action_id "${action.action_id}"`);
        break actionLoop;
      }
      seen.add(action.action_id);
    }
    if (actions.length === 0) {
      add('/presentation/actions', 'empty_actions', 'actions must not be empty when provided');
    }
  }

  const duration = policy.action?.parameters?.['duration_minutes'];
  if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) {
    add('/action/parameters/duration_minutes', 'invalid_duration', 'duration_minutes must be a positive number');
  }

  if (!Number.isInteger(policy.version) || policy.version < 1) {
    add('/version', 'invalid_version', 'version must be a positive integer');
  }

  if (!POLICY_DECISIONS.includes(policy.decision)) {
    add('/decision', 'unknown_decision', `unknown decision "${String(policy.decision)}"`);
  }

  if (!AUDIT_LEVELS.includes(safety.audit_level)) {
    add('/safety/audit_level', 'unknown_audit_level', `unknown audit_level "${String(safety.audit_level)}"`);
  }

  return issues;
}
