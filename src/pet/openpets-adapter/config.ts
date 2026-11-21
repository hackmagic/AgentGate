import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reversible configuration.
 *
 * The OpenPets contract asks two things of config, and both are about not
 * destroying the user's own file:
 *
 * 1. **Managed, not owned.** Entries this adapter writes are marked, so a later
 *    version can find, update and remove exactly its own entries without
 *    touching anything the user wrote by hand.
 * 2. **Reversible.** Installation backs up, writes atomically, and records
 *    enough to put the file back exactly as it was. Removal must restore the
 *    original bytes, not "a file that looks similar".
 *
 * A third property is specific to us: the adapter is a *consumer* of OpenPets,
 * so its config is small (an enable flag and a sparse set of options). Keeping
 * a whole backup for two fields would be overkill; keeping the original file
 * when it did not exist at all is not.
 */

/** Marker embedded in managed entries so we can find our own without guessing. */
export const MANAGED_MARKER = 'agent-gate';

export interface AdapterConfig {
  enabled: boolean;
  /** Emit reactions at all. Turning this off keeps speech. */
  reactions: boolean;
  /** Emit speech at all. */
  speech: boolean;
  /** Optional explicit pet id; omitted means the default target. */
  petId: string | null;
  /** Marker proving this block was written by us. */
  managedBy: string;
}

export const DEFAULT_CONFIG: AdapterConfig = Object.freeze({
  enabled: true,
  reactions: true,
  speech: true,
  petId: null,
  managedBy: MANAGED_MARKER,
});

export interface InstallResult {
  ok: boolean;
  /** Path written. */
  file: string;
  /** True when a backup was written because a file already existed. */
  backedUp: boolean;
  /** True when this install created the file. */
  created: boolean;
  error?: string;
}

export interface RemoveResult {
  ok: boolean;
  file: string;
  /** True when the file was removed because we created it. */
  deleted: boolean;
  /** True when a pre-existing file was restored from the backup. */
  restored: boolean;
  error?: string;
}

interface StoredFile {
  /**
   * Present only when we wrote into a file that already existed.
   *
   * Stored as the **original text**, never as a parsed value: restoring a
   * reparsed object reformats the user's file (indentation, key spacing,
   * number formatting) and "reversible" then means "mostly reversible". Bytes
   * in, bytes out.
   */
  backup?: string;
  config: AdapterConfig;
}

/**
 * Merge untrusted input into a config, keeping the marker authoritative.
 *
 * `managedBy` is never taken from input: a file claiming a different owner is
 * not ours to honour, and letting the value through would let one tool adopt
 * another's block.
 */
export function sanitizeConfig(input: unknown, base: AdapterConfig = DEFAULT_CONFIG): AdapterConfig {
  const source = isRecord(input) ? input : {};
  return {
    enabled: typeof source['enabled'] === 'boolean' ? source['enabled'] : base.enabled,
    reactions: typeof source['reactions'] === 'boolean' ? source['reactions'] : base.reactions,
    speech: typeof source['speech'] === 'boolean' ? source['speech'] : base.speech,
    petId: typeof source['petId'] === 'string' && source['petId'].trim() !== '' ? source['petId'].trim() : null,
    managedBy: MANAGED_MARKER,
  };
}

export function readConfig(file: string): AdapterConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(parsed)) return { ...DEFAULT_CONFIG };
    return sanitizeConfig(parsed['config']);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Install atomically: stage, then rename.
 *
 * A failed write must leave the previous file byte-identical. That is why the
 * backup is captured *before* the staging file is promoted, and why a staging
 * failure removes only the staging file.
 */
export function installConfig(file: string, config: Partial<AdapterConfig> = {}): InstallResult {
  const previous = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const next = sanitizeConfig({ ...readConfig(file), ...config }, DEFAULT_CONFIG);

  // Keep the raw text, not a parsed copy: see `StoredFile.backup`.
  const stored: StoredFile = previous === null ? { config: next } : { backup: previous, config: next };
  const staging = `${file}.${process.pid}.staging`;

  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(staging, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    renameSync(staging, file);
    return { ok: true, file, backedUp: previous !== null, created: previous === null };
  } catch (error) {
    try {
      rmSync(staging, { force: true });
    } catch {
      // Leftover staging files are overwritten next time.
    }
    return { ok: false, file, backedUp: false, created: false, error: describe(error) };
  }
}

/**
 * Remove what we installed.
 *
 * Three outcomes, and the caller must be able to tell them apart:
 * - we created the file, so remove it;
 * - we wrote into a file that already existed, so restore the backup;
 * - the file holds something we cannot attribute to us, so leave it alone and
 *   report that rather than guessing.
 */
export function removeConfig(file: string): RemoveResult {
  if (!existsSync(file)) {
    return { ok: true, file, deleted: false, restored: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, file, deleted: false, restored: false, error: describe(error) };
  }

  if (!isRecord(parsed) || !isRecord(parsed['config'])) {
    return { ok: false, file, deleted: false, restored: false, error: 'not an agent-gate config file' };
  }
  if (parsed['config']['managedBy'] !== MANAGED_MARKER) {
    return { ok: false, file, deleted: false, restored: false, error: 'config is owned by something else' };
  }

  const backup = parsed['backup'];
  try {
    if (backup === undefined) {
      rmSync(file, { force: true });
      return { ok: true, file, deleted: true, restored: false };
    }

    // The backup is the original text, so it is written back unchanged.
    if (typeof backup !== 'string') {
      return { ok: false, file, deleted: false, restored: false, error: 'backup is not restorable text' };
    }
    const staging = `${file}.${process.pid}.restore`;
    writeFileSync(staging, backup, 'utf8');
    renameSync(staging, file);
    return { ok: true, file, deleted: false, restored: true };
  } catch (error) {
    return { ok: false, file, deleted: false, restored: false, error: describe(error) };
  }
}

/** True when the file exists and is attributable to this adapter. */
export function isInstalled(file: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isRecord(parsed) && isRecord(parsed['config']) && parsed['config']['managedBy'] === MANAGED_MARKER;
  } catch {
    return false;
  }
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
