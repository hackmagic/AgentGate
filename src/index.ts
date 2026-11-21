export { normalizeEvent, type NormalizeEventOptions } from './events/normalize.js';
export { eventsFromActivityWatch, type ActivityWatchOptions } from './events/activitywatch.js';
export {
  EVENT_SOURCES,
  EVENT_TYPES,
  isEventSource,
  isGuidanceEventType,
  type EventContext,
  type EventSource,
  type GuidanceEvent,
  type GuidanceEventType,
} from './events/types.js';

export {
  ACTION_IDS,
  ANIMATION_HINTS,
  AUDIT_LEVELS,
  POLICY_DECISIONS,
  SIGNAL_DECISIONS,
  WEEKDAYS,
  comparePolicyPriority,
  isConditionGroup,
  unwrapPolicy,
  type ActionId,
  type AnimationHint,
  type AuditLevel,
  type Condition,
  type ConditionGroup,
  type ConditionLeaf,
  type Policy,
  type PolicyAction,
  type PolicyDocument,
  type PolicyEscalation,
  type PolicyInput,
  type PolicyPresentation,
  type PolicySafety,
  type PolicyTrigger,
  type PolicyDecision,
  type SignalDecision,
  type TriggerContextMatcher,
} from './policy/types.js';

export { evaluateConditions, matchesTimeWindow, type ConditionResult } from './policy/conditions.js';
export { loadPolicies, loadPolicyDirectory, loadPolicyFile, type LoadedPolicy } from './policy/load.js';
export { evaluateEvent, type EvaluationResult, type PolicyTrace } from './policy/evaluate.js';
export { validatePolicyDocument, type PolicyIssue, type PolicyValidationResult } from './policy/validate.js';
export {
  DEFAULT_MUTE_THRESHOLD,
  applyResponse,
  emptyMuteState,
  getPolicyMuteState,
  isPolicyMuted,
  markPresented,
  unmutePolicy,
  type MuteState,
  type PolicyMuteState,
} from './policy/mute.js';
export { summarizePolicy, summarizeSignal, type PolicySummary } from './policy/summary.js';

export { BUBBLE_MAX_CHARS, buildPresentation, buildSignal } from './signal/build.js';
export { assertSignalInvariants, validateSignal } from './signal/validate.js';
export { type GuidanceResponse, type GuidanceSignal, type SignalPresentation } from './signal/types.js';

export {
  AUDIT_FIELD_WHITELIST,
  AUDIT_REASONS,
  JsonlAuditStore,
  MemoryAuditStore,
  assertAuditRecordSafe,
  createAuditRecord,
  type AuditQuery,
  type AuditRecord,
  type AuditStore,
} from './audit/store.js';

export {
  DEFAULT_PRESENTATION_WINDOW_MINUTES,
  GuidanceEngine,
  type EngineOptions,
  type EvaluateOutcome,
  type RespondOutcome,
} from './engine.js';

export { createPetServer, errorStatus, listen, type PetServer, type PetServerOptions } from './pet/http.js';
export { PET_ENGINE_NAME, PetBridge, RateLimitError, type PetBridgeOptions } from './pet/bridge.js';

export {
  MCP_PROTOCOL_VERSION,
  McpServer,
  SERVER_NAME,
  TOOL_NAMES,
  serveStdio,
  toolDefinitions,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ToolDefinition,
} from './mcp/server.js';

export {
  COMPILE_TARGETS,
  compileAllTargets,
  compilePolicies,
  writeBundle,
  type CompileTarget,
  type CompilationBundle,
  type CompiledFile,
} from './compile/index.js';

export { ENGINE_VERSION } from './version.js';
export { ContractError, GuidanceError, errorMessage } from './errors.js';
export { validateSchema, formatSchemaIssues, type JsonSchema, type SchemaIssue } from './schema/validator.js';
export { loadSchema, schemaFiles, type SchemaName } from './schema/load.js';
export {
  addMinutes,
  fixedClock,
  manualClock,
  systemClock,
  toIso,
  type Clock,
} from './util/clock.js';
export { sha256, stableStringify } from './util/hash.js';
export { charLength, truncateChars } from './util/text.js';
