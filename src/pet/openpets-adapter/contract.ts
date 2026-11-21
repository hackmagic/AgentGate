/**
 * The OpenPets integration contract, expressed as data.
 *
 * Every number and enum below is taken from the published OpenPets
 * documentation (docs.openpets.dev/ipc and /agent-integrations) rather than
 * invented here. Keeping them in one file means a contract change is a
 * one-line diff, and the tests can assert the adapter stays inside them.
 *
 * Nothing in this file talks to OpenPets; it is the shape of the promise.
 */

/** Protocol revision the IPC wire format validates on both ends. */
export const OPENPETS_PROTOCOL_VERSION = 'v1';

/** A message is one JSON object terminated by a newline. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** Connect and response budgets from the IPC reference. */
export const CONNECT_TIMEOUT_MS = 2_000;
export const RESPONSE_TIMEOUT_MS = 3_000;

/**
 * Lease lifetime. A lease is a 15s claim kept alive by heartbeats; the TTL is
 * also the recovery budget when a process dies without releasing.
 */
export const LEASE_TTL_MS = 15_000;

/**
 * Heartbeat cadence. The MCP server uses ~5s; OpenCode renews with a ~2s
 * buffer before expiry. We take the MCP value and keep the buffer so one
 * dropped beat does not drop the pet.
 */
export const LEASE_HEARTBEAT_MS = 5_000;
export const LEASE_HEARTBEAT_BUFFER_MS = 2_000;

/**
 * Speech rules enforced by `@open-pets/agent-events`: a single line, 1-140
 * characters, and no code, URLs, file paths or secret-like tokens.
 *
 * The length bound and the "one line" rule are what an adapter can check
 * cheaply; the content rules are checked by `isSafeSpeech` in speech.ts.
 */
export const SPEECH_MIN_CHARS = 1;
export const SPEECH_MAX_CHARS = 140;

/** Cooldowns the reference integrations apply, so the pet does not chatter. */
export const SPEECH_COOLDOWN_MS = 20_000;
export const REACTION_COOLDOWN_MS = 3_000;

/**
 * Reactions this adapter is willing to emit.
 *
 * `pet.react` takes a closed enum and the client rejects anything outside it.
 * This is the subset documented across the official integrations (DSH, Claude,
 * OpenCode), restricted to names that appear in their event tables. Anything
 * not listed here is never sent, which is what keeps an unknown reaction from
 * turning into a dropped call or a wrong animation.
 */
export const REACTIONS = [
  'thinking',
  'working',
  'editing',
  'running',
  'testing',
  'waiting',
  'success',
  'error',
] as const;
export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: string): value is Reaction {
  return (REACTIONS as readonly string[]).includes(value);
}

/**
 * Speech categories with curated pools. Automatic messages come from these,
 * never from raw policy or model text: that is the whole point of the pool.
 */
export const SPEECH_CATEGORIES = ['thinking', 'success', 'error', 'permission', 'question'] as const;
export type SpeechCategory = (typeof SPEECH_CATEGORIES)[number];
