export { normalizeEvent, type NormalizeEventOptions } from './events/normalize.js';
export { eventsFromActivityWatch, type ActivityWatchOptions } from './events/activitywatch.js';
export {
  EVENT_SOURCES,
  EVENT_TYPES,
  isEventSource,
  isAgentEventType,
  type EventContext,
  type EventSource,
  type AgentEvent,
  type AgentEventType,
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
export {
  ARCHIVE_REASONS,
  LIFECYCLE_STATES,
  authoringState,
  projectLifecycle,
  type ArchiveReason,
  type LifecycleState,
  type LifecycleTransition,
  type PolicyLifecycle,
} from './policy/lifecycle.js';

export { BUBBLE_MAX_CHARS, buildPresentation, buildSignal } from './signal/build.js';
export { assertSignalInvariants, validateSignal } from './signal/validate.js';
export { type GateResponse, type GateSignal, type SignalPresentation } from './signal/types.js';

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
  AgentGate,
  DEFAULT_PRESENTATION_WINDOW_MINUTES,
  SignalInbox,
  ThrottleState,
  append,
  auditStage,
  inboxStage,
  isThrottled,
  queryAudit,
  runStages,
  stageNames,
  throttleStage,
  type AppendInput,
  type AuditSink,
  type AuditStageOptions,
  type EvaluateOutcome,
  type GateCall,
  type GateOptions,
  type GateStage,
  type PendingSignal,
  type RespondOutcome,
  type ThrottleOptions,
} from './gate/index.js';

export { createPetServer, errorStatus, listen, type PetServer, type PetServerOptions } from './pet/http.js';
export { PET_ENGINE_NAME, PetBridge, RateLimitError, type PetBridgeOptions } from './pet/bridge.js';
export {
  DEFAULT_CONFIG as OPENPETS_DEFAULT_CONFIG,
  LEASE_HEARTBEAT_MS,
  LEASE_TTL_MS,
  LeaseManager,
  MANAGED_MARKER,
  OpenPetsUnavailableError,
  REACTIONS,
  SPEECH_CATEGORIES,
  createIpcTransport,
  createOpenPetsAdapter,
  defaultDiscoveryPath,
  dispatchForEmpty,
  dispatchForSignal,
  installConfig,
  isInstalled,
  isReaction,
  isSafeSpeech,
  pickSpeech,
  readConfig as readOpenPetsConfig,
  readDiscovery,
  removeConfig,
  resolveDispatch,
  runtimeForEvent,
  sanitizeConfig as sanitizeOpenPetsConfig,
  type AdapterConfig as OpenPetsAdapterConfig,
  type AdapterStats as OpenPetsAdapterStats,
  type Dispatch as OpenPetsDispatch,
  type LeaseSnapshot,
  type OpenPetsAdapter,
  type PetTransport,
  type Reaction as OpenPetsReaction,
  type SpeechCategory,
} from './pet/openpets-adapter/index.js';

export {
  PetBridgeClient,
  RemoteBridgeError,
  isLoopbackUrl,
  type OnSignalOptions,
  type PetBridgeClientOptions,
  type PetEventOutcome,
  type PetHealth,
  type PetRespondOutcome,
  type SignalPoller,
} from './pet/client.js';

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
  COMPILE_FORMAT_VERSION,
  COMPILE_TARGETS,
  compileAllTargets,
  compilePolicies,
  writeBundle,
  type CompileTarget,
  type CompilationBundle,
  type CompiledFile,
} from './compile/index.js';

export {
  readAgentsMd,
  readSkillMd,
  verifyCompilation,
  type ArtifactFact,
  type ParityIssue,
  type ParityReport,
} from './compile/verify.js';

export { ENGINE_VERSION } from './version.js';
export { AgentGateError, ContractError, errorMessage } from './errors.js';
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
