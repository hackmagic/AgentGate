import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { JsonSchema } from './validator.js';

/**
 * Schemas live at `<package>/schemas/*.schema.json`, one directory above
 * `dist/`, so the same path works from `src/` (tsx) and `dist/` (published).
 */
const schemaDirectory = fileURLToPath(new URL('../../schemas/', import.meta.url));

const cache = new Map<string, JsonSchema>();

export function loadSchema(name: string): JsonSchema {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const file = path.join(schemaDirectory, `${name}.schema.json`);
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`schema ${name} is not a JSON object`);
  }
  const schema = parsed as JsonSchema;
  cache.set(name, schema);
  return schema;
}

export const schemaFiles = ['policy', 'event', 'signal', 'pet-contract', 'audit'] as const;
export type SchemaName = (typeof schemaFiles)[number];
