import { ContractError } from '../errors.js';
import { loadSchema } from '../schema/load.js';
import { validateSchema } from '../schema/validator.js';
import { charLength } from '../util/text.js';
import { BUBBLE_MAX_CHARS } from './build.js';
import type { GateSignal } from './types.js';

/** Validate a signal payload against its schema and its presentation invariants. */
export function validateSignal(raw: unknown): GateSignal {
  const result = validateSchema(raw, loadSchema('signal'));
  if (!result.valid) {
    throw new ContractError('invalid_signal', 'signal does not satisfy schemas/signal.schema.json', result.issues);
  }
  const signal = raw as GateSignal;

  if (charLength(signal.presentation.bubble_text) > BUBBLE_MAX_CHARS) {
    throw new ContractError('invalid_signal', `bubble_text must be at most ${BUBBLE_MAX_CHARS} characters`);
  }
  if (signal.decision === 'require_approval') {
    const hasRefusal = signal.presentation.actions.some((action) => action.action_id !== 'approve');
    if (!hasRefusal) {
      throw new ContractError('invalid_signal', 'require_approval signals need at least one refusal action');
    }
  }
  return signal;
}

export function assertSignalInvariants(signal: GateSignal): void {
  validateSignal(structuredClone(signal));
}
