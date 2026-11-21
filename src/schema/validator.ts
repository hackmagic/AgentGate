/**
 * Minimal JSON Schema validator covering the draft 2020-12 subset used by
 * the contracts in `schemas/`. Keeping this in-tree means the runtime has no
 * schema-library dependency and the validation rules stay auditable.
 */
export type JsonSchema = Record<string, unknown>;

export interface SchemaIssue {
  /** JSON pointer to the offending value, e.g. `/policy/safety`. */
  path: string;
  /** Schema keyword that rejected the value. */
  keyword: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: SchemaIssue[];
}

export function validateSchema(value: unknown, schema: JsonSchema): SchemaValidationResult {
  const issues: SchemaIssue[] = [];
  check(value, schema, '', schema, issues);
  return { valid: issues.length === 0, issues };
}

export function formatSchemaIssues(issues: readonly SchemaIssue[]): string {
  return issues.map((issue) => `${issue.path === '' ? '/' : issue.path} (${issue.keyword}): ${issue.message}`).join('\n');
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function childPath(path: string, key: string | number): string {
  return `${path}/${escapePointer(String(key))}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return isObject(current) ? current : undefined;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

function check(
  value: unknown,
  schema: JsonSchema,
  path: string,
  root: JsonSchema,
  issues: SchemaIssue[],
): void {
  if (typeof schema === 'boolean') {
    if (!schema) issues.push({ path, keyword: 'false', message: 'value is not allowed here' });
    return;
  }

  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root);
    if (target === undefined) {
      issues.push({ path, keyword: '$ref', message: `unresolvable reference ${schema.$ref}` });
      return;
    }
    check(value, target, path, root, issues);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type.map(String) : [String(schema.type)];
    if (!types.some((type) => matchesType(value, type))) {
      issues.push({ path, keyword: 'type', message: `expected ${types.join(' | ')}, received ${describe(value)}` });
      return;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    issues.push({
      path,
      keyword: 'enum',
      message: `expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`,
    });
  }

  if ('const' in schema && !deepEqual(schema.const, value)) {
    issues.push({ path, keyword: 'const', message: `expected ${JSON.stringify(schema.const)}` });
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ path, keyword: 'minimum', message: `must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ path, keyword: 'maximum', message: `must be <= ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      issues.push({ path, keyword: 'exclusiveMinimum', message: `must be > ${schema.exclusiveMinimum}` });
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      issues.push({ path, keyword: 'exclusiveMaximum', message: `must be < ${schema.exclusiveMaximum}` });
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ path, keyword: 'minLength', message: `must contain at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ path, keyword: 'maxLength', message: `must contain at most ${schema.maxLength} characters` });
    }
    if (typeof schema.pattern === 'string') {
      let pattern: RegExp | undefined;
      try {
        pattern = new RegExp(schema.pattern, 'u');
      } catch {
        pattern = undefined;
      }
      if (pattern !== undefined && !pattern.test(value)) {
        issues.push({ path, keyword: 'pattern', message: `must match ${schema.pattern}` });
      }
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      issues.push({ path, keyword: 'format', message: 'must be an ISO 8601 date-time' });
    }
    if (schema.format === 'uri' && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      issues.push({ path, keyword: 'format', message: 'must be a URI' });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ path, keyword: 'minItems', message: `must contain at least ${schema.minItems} items` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ path, keyword: 'maxItems', message: `must contain at most ${schema.maxItems} items` });
    }
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        for (let other = index + 1; other < value.length; other += 1) {
          if (deepEqual(value[index], value[other])) {
            issues.push({ path: childPath(path, index), keyword: 'uniqueItems', message: 'duplicate item' });
          }
        }
      }
    }
    if (Array.isArray(schema.items)) {
      schema.items.forEach((itemSchema, index) => {
        if (index < value.length && isObject(itemSchema as unknown)) {
          check(value[index], itemSchema as JsonSchema, childPath(path, index), root, issues);
        }
      });
    } else if (isObject(schema.items)) {
      value.forEach((item, index) => check(item, schema.items as JsonSchema, childPath(path, index), root, issues));
    }
  }

  if (isObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const requiredKey of schema.required.map(String)) {
        if (!(requiredKey in value)) {
          issues.push({ path, keyword: 'required', message: `missing required property "${requiredKey}"` });
        }
      }
    }

    const properties = isObject(schema.properties) ? schema.properties : {};
    const patternProperties = isObject(schema.patternProperties) ? schema.patternProperties : {};
    const additional = schema.additionalProperties;

    for (const [key, propertyValue] of Object.entries(value)) {
      const propertyPath = childPath(path, key);
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        const propertySchema = properties[key];
        if (isObject(propertySchema) || typeof propertySchema === 'boolean') {
          check(propertyValue, propertySchema as JsonSchema, propertyPath, root, issues);
        }
        continue;
      }

      let matchedPattern = false;
      for (const [pattern, patternSchema] of Object.entries(patternProperties)) {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, 'u');
        } catch {
          continue;
        }
        if (regex.test(key)) {
          matchedPattern = true;
          if (isObject(patternSchema) || typeof patternSchema === 'boolean') {
            check(propertyValue, patternSchema as JsonSchema, propertyPath, root, issues);
          }
        }
      }
      if (matchedPattern) continue;

      if (additional === false) {
        issues.push({ path: propertyPath, keyword: 'additionalProperties', message: `unknown property "${key}"` });
      } else if (isObject(additional)) {
        check(propertyValue, additional, propertyPath, root, issues);
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (isObject(branch)) check(value, branch, path, root, issues);
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const branchResults = schema.anyOf.map((branch) => {
      const branchIssues: SchemaIssue[] = [];
      if (isObject(branch)) check(value, branch, path, root, branchIssues);
      return branchIssues;
    });
    if (!branchResults.some((branchIssues) => branchIssues.length === 0)) {
      const firstFailure = branchResults.find((branchIssues) => branchIssues.length > 0) ?? [];
      const detail = firstFailure[0];
      issues.push({
        path,
        keyword: 'anyOf',
        message: detail === undefined ? 'does not match any allowed shape' : `does not match any allowed shape (${detail.message})`,
      });
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const branchResults = schema.oneOf.map((branch) => {
      const branchIssues: SchemaIssue[] = [];
      if (isObject(branch)) check(value, branch, path, root, branchIssues);
      return branchIssues;
    });
    const passing = branchResults.filter((branchIssues) => branchIssues.length === 0).length;
    if (passing !== 1) {
      const firstFailure = branchResults.find((branchIssues) => branchIssues.length > 0) ?? [];
      const detail = firstFailure[0];
      issues.push({
        path,
        keyword: 'oneOf',
        message:
          passing === 0
            ? `does not match any allowed shape${detail === undefined ? '' : ` (${detail.message})`}`
            : 'matches more than one mutually exclusive shape',
      });
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
