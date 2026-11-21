/** Structural shape shared by every validation issue the runtime reports. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Base class for every error the runtime raises on purpose. */
export class AgentGateError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AgentGateError';
    this.code = code;
  }
}

/** A contract (policy / event / signal / audit record) failed validation. */
export class ContractError extends AgentGateError {
  readonly issues: readonly ValidationIssue[];

  constructor(code: string, message: string, issues: readonly ValidationIssue[] = []) {
    super(code, message);
    this.name = 'ContractError';
    this.issues = issues;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
