import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Policy } from '../policy/types.js';
import { sha256, stableStringify } from '../util/hash.js';
import { ENGINE_VERSION } from '../version.js';
import { compileAgentsMd } from './agents-md.js';
import { compileMcpBundle } from './mcp-bundle.js';
import { compileSkills } from './skill-md.js';

export const COMPILE_TARGETS = ['agents', 'skill', 'mcp'] as const;
export type CompileTarget = (typeof COMPILE_TARGETS)[number];

export interface CompiledFile {
  /** Path relative to the bundle root. */
  path: string;
  content: string;
  sha256: string;
}

export interface CompilationBundle {
  target: CompileTarget;
  engine_version: string;
  /** Hash of the ordered policy set this bundle was compiled from. */
  source_hash: string;
  files: CompiledFile[];
}

/**
 * Compile the same policy set into different agent surfaces. The mapping from
 * policy fields to artifact sections is fixed (docs/03-compilation-model.md),
 * so two agents reading two artifacts obey the same rule.
 */
export function compilePolicies(policies: readonly Policy[], target: CompileTarget): CompilationBundle {
  const ordered = [...policies].sort((a, b) => a.id.localeCompare(b.id));
  const sourceHash = sha256(stableStringify(ordered));

  switch (target) {
    case 'agents':
      return {
        target,
        engine_version: ENGINE_VERSION,
        source_hash: sourceHash,
        files: [file('AGENTS.md', compileAgentsMd(ordered))],
      };

    case 'skill':
      return {
        target,
        engine_version: ENGINE_VERSION,
        source_hash: sourceHash,
        files: compileSkills(ordered).map((skill) => file(`skills/${skill.name}/SKILL.md`, skill.content)),
      };

    case 'mcp':
      return {
        target,
        engine_version: ENGINE_VERSION,
        source_hash: sourceHash,
        files: compileMcpBundle(ordered).map((entry) => file(entry.path, entry.content)),
      };

    default: {
      const exhaustive: never = target;
      throw new TypeError(`unknown compile target: ${String(exhaustive)}`);
    }
  }
}

export function compileAllTargets(
  policies: readonly Policy[],
  targets: readonly CompileTarget[] = COMPILE_TARGETS,
): CompilationBundle[] {
  return targets.map((target) => compilePolicies(policies, target));
}

/** Write a bundle under `outDir`; refuses paths that escape it. */
export function writeBundle(bundle: CompilationBundle, outDir: string): string[] {
  const written: string[] = [];
  for (const compiled of bundle.files) {
    const normalized = path.normalize(compiled.path);
    if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
      throw new TypeError(`refusing to write outside the output directory: ${compiled.path}`);
    }
    const absolute = path.join(outDir, normalized);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, compiled.content, 'utf8');
    written.push(absolute);
  }
  return written;
}

function file(relativePath: string, content: string): CompiledFile {
  return { path: relativePath, content, sha256: sha256(content) };
}
