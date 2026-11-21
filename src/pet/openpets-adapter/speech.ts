import { SPEECH_MAX_CHARS, SPEECH_MIN_CHARS, type SpeechCategory } from './contract.js';

/**
 * Curated speech pools, mirroring `@open-pets/agent-events`.
 *
 * The rule that matters: **an automatic message is chosen from a pool, never
 * composed from policy text.** The temptation is to send `bubble_text` because
 * it is right there and it is already user-facing. Doing that would leak policy
 * internals into a bubble the user did not ask to be spoken, and it would put
 * the engine in the business of writing prose for a surface it does not own.
 *
 * `bubble_text` still reaches the user: the prompt surface renders it. Speech
 * is a separate, quieter channel, so it stays generic.
 */
const POOLS: Record<SpeechCategory, readonly string[]> = {
  thinking: ['Thinking…', 'Working on it…', 'One moment…'],
  success: ['Done.', 'Finished.', 'All set.'],
  error: ['Something went wrong.', 'That did not work.', 'Hit a problem.'],
  permission: ['Needs your approval.', 'Waiting for you.', 'Your call.'],
  question: ['Question for you.', 'I need an answer.', 'Can you confirm?'],
};

/**
 * Deterministic pick. A random pick would make tests flaky and make two runs
 * of the same event sound different; rotating by a counter gives variety
 * within a session and reproducibility in a test.
 */
export function pickSpeech(category: SpeechCategory, ordinal = 0): string {
  const pool = POOLS[category];
  const index = Math.abs(Math.trunc(ordinal)) % pool.length;
  return pool[index] as string;
}

export function speechPool(category: SpeechCategory): readonly string[] {
  return POOLS[category];
}

/**
 * Content rules from `@open-pets/agent-events`, reimplemented locally so the
 * adapter can refuse a message *before* it reaches a bubble rather than
 * discovering later that a bubble showed something it should not have.
 *
 * These are heuristics matching the documented intent (no code, URLs, paths or
 * secret-like tokens), not a byte-for-byte reimplementation of that package.
 */
export function isSafeSpeech(message: string): boolean {
  if (typeof message !== 'string') return false;

  const length = [...message].length;
  if (length < SPEECH_MIN_CHARS || length > SPEECH_MAX_CHARS) return false;

  // Single line: a newline would let a message smuggle a second paragraph.
  if (/[\r\n\u2028\u2029]/.test(message)) return false;

  // URLs and file paths.
  if (/\b(?:https?|ftp|file|javascript|data):/i.test(message)) return false;
  if (/(?:^|\s)[A-Za-z]:[\\/]/.test(message)) return false;
  if (/(?:^|\s)~\//.test(message)) return false;
  if (/(?:^|\s)\/\S+/.test(message)) return false;

  // Secret-like tokens: long unbroken identifiers, keys, and env-var names.
  if (/\b[A-Za-z_][A-Za-z0-9_]{23,}\b/.test(message)) return false;
  if (/\b(?:sk|pk|ghp|gho|glpat|xox[abp])[-_][A-Za-z0-9_-]{8,}/i.test(message)) return false;
  if (/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(message)) return false;

  // Code-ish punctuation that no canned message needs.
  if (/[{}<>`;$\\]/.test(message)) return false;

  return true;
}

/**
 * Last-line filter. Pools are ours and already safe, so a rejection here means
 * the pool was edited badly; callers treat it as "say nothing" rather than
 * sending something unchecked.
 */
export function safeSpeechOrNull(message: string): string | null {
  return isSafeSpeech(message) ? message : null;
}
