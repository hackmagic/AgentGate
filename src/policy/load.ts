import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { ContractError } from '../errors.js';
import type { Policy } from './types.js';
import { validatePolicyDocument } from './validate.js';

export interface LoadedPolicy {
  policy: Policy;
  file: string;
}

const POLICY_EXTENSIONS = new Set(['.yaml', '.yml']);

/** A pack manifest describes the pack itself; it is never a policy document. */
const MANIFEST_NAMES = new Set(['pack.yaml', 'pack.yml']);

/** Read, parse and validate a single policy file. */
export function loadPolicyFile(file: string): LoadedPolicy {
  const text = readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = parseYaml(text, { strict: true });
  } catch (error) {
    throw new ContractError('invalid_policy_yaml', `${file}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = validatePolicyDocument(parsed, file);
  if (!result.valid || result.policy === null) {
    throw new ContractError(
      'invalid_policy',
      `${file}: ${result.issues.map((issue) => `${issue.path} (${issue.code}): ${issue.message}`).join('; ')}`,
    );
  }
  return { policy: result.policy, file };
}

/** Load every policy file under `directory`, rejecting duplicate ids. */
export function loadPolicyDirectory(directory: string): LoadedPolicy[] {
  const files = collectPolicyFiles(directory);
  return assertUniqueIds(files.map((file) => loadPolicyFile(file)));
}

/** Accept files, directories, or a mix. */
export function loadPolicies(paths: readonly string[]): LoadedPolicy[] {
  const result: LoadedPolicy[] = [];
  for (const input of paths) {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(input);
    } catch {
      throw new ContractError('policy_path_not_found', `${input}: no such file or directory`);
    }

    if (stat.isDirectory()) {
      result.push(...loadPolicyDirectory(input));
    } else if (POLICY_EXTENSIONS.has(path.extname(input).toLowerCase())) {
      result.push(loadPolicyFile(input));
    } else {
      throw new ContractError('unsupported_policy_path', `${input}: expected a .yaml/.yml file or a directory`);
    }
  }
  return assertUniqueIds(result);
}

function assertUniqueIds(loaded: LoadedPolicy[]): LoadedPolicy[] {
  const seen = new Map<string, string>();
  for (const entry of loaded) {
    const existing = seen.get(entry.policy.id);
    if (existing !== undefined) {
      throw new ContractError('duplicate_policy_id', `policy "${entry.policy.id}" is defined in both ${existing} and ${entry.file}`);
    }
    seen.set(entry.policy.id, entry.file);
  }
  return loaded;
}

function collectPolicyFiles(directory: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPolicyFiles(absolute));
    } else if (
      entry.isFile() &&
      POLICY_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) &&
      !MANIFEST_NAMES.has(entry.name.toLowerCase())
    ) {
      files.push(absolute);
    }
  }
  return files.sort();
}
