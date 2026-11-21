import type { GateCall, GateStage } from './types.js';

/**
 * Run the evaluation pipeline: `before` hooks, the pure evaluator, then
 * `after` hooks — every hook in registration order.
 *
 * Registration order is the contract: compose `throttle → inbox → audit` and
 * throttling is decided before the inbox accepts a signal, while the audit
 * stage sees the final, post-downgrade call state.
 */
export function runStages(
  stages: readonly GateStage[],
  call: GateCall,
  evaluate: (call: GateCall) => void,
): void {
  for (const stage of stages) stage.before?.(call);
  evaluate(call);
  for (const stage of stages) stage.after?.(call);

  if (call.result === null) {
    throw new Error('gate pipeline ran no evaluation stage');
  }
}

/** Names of the stages in execution order; handy for diagnostics and tests. */
export function stageNames(stages: readonly GateStage[]): string[] {
  return stages.map((stage) => stage.name);
}
