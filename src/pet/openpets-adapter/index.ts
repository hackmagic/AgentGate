export {
  LEASE_HEARTBEAT_MS,
  LEASE_TTL_MS,
  MAX_MESSAGE_BYTES,
  OPENPETS_PROTOCOL_VERSION,
  REACTIONS,
  REACTION_COOLDOWN_MS,
  SPEECH_CATEGORIES,
  SPEECH_COOLDOWN_MS,
  SPEECH_MAX_CHARS,
  isReaction,
  type Reaction,
  type SpeechCategory,
} from './contract.js';

export {
  LeaseManager,
  type LeaseManagerOptions,
  type LeaseSnapshot,
  type LeaseState,
  type LeaseTransport,
} from './lease.js';

export {
  pickSpeech,
  isSafeSpeech,
  safeSpeechOrNull,
  speechPool,
} from './speech.js';

export {
  dispatchForEmpty,
  dispatchForSignal,
  resolveDispatch,
  runtimeForEvent,
  type Dispatch,
} from './map.js';

export {
  createOpenPetsAdapter,
  type AdapterStats,
  type OpenPetsAdapter,
  type OpenPetsAdapterOptions,
  type PetTransport,
} from './adapter.js';

export {
  DEFAULT_CONFIG,
  MANAGED_MARKER,
  installConfig,
  isInstalled,
  readConfig,
  removeConfig,
  sanitizeConfig,
  type AdapterConfig,
  type InstallResult,
  type RemoveResult,
} from './config.js';

export {
  OpenPetsUnavailableError,
  connectToEndpoint,
  createIpcTransport,
  defaultDiscoveryPath,
  readDiscovery,
  sendRequest,
  type DiscoveryFile,
  type IpcTransportOptions,
  type SocketLike,
} from './ipc.js';
