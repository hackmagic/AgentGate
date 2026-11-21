import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ContractError } from '../errors.js';
import { validateSchema } from '../schema/validator.js';
import { loadSchema } from '../schema/load.js';
import type { PolicyDecision } from '../policy/types.js';

export const AUDIT_REASONS = [
  'matched',
  'degraded',
  'muted',
  'rate_limited',
  'user_approved',
  'user_dismissed',
  'user_muted',
] as const;
export type AuditReason = (typeof AUDIT_REASONS)[number];

/**
 * Content-free by construction. This whitelist is the audit contract from
 * docs/08-security-and-audit.md: never a window title, screenshot, clipboard
 * payload or keystroke.
 */
export const AUDIT_FIELD_WHITELIST = [
  'event_id',
  'policy_id',
  'decision',
  'signal_id',
  'user_response',
  'timestamp',
  'engine_version',
  'degraded',
  'reason',
] as const;

export type AuditField = (typeof AUDIT_FIELD_WHITELIST)[number];

export interface AuditRecord {
  event_id: string;
  policy_id: string;
  decision: PolicyDecision | 'error';
  signal_id: string | null;
  user_response: string | null;
  timestamp: string;
  engine_version: string;
  degraded: boolean;
  reason: AuditReason;
}

export interface AuditQuery {
  since?: string;
  policy_id?: string;
  limit?: number;
}

export interface AuditStore {
  append(record: AuditRecord): void;
  query(query?: AuditQuery): AuditRecord[];
}

/** Strip anything outside the whitelist and reject malformed records. */
export function createAuditRecord(input: Record<string, unknown>): AuditRecord {
  const filtered: Record<string, unknown> = {};
  for (const field of AUDIT_FIELD_WHITELIST) {
    if (field in input) filtered[field] = input[field];
  }

  const result = validateSchema(filtered, loadSchema('audit'));
  if (!result.valid) {
    throw new ContractError('invalid_audit_record', 'audit record violates the field whitelist', result.issues);
  }
  return filtered as unknown as AuditRecord;
}

/** Defensive check used by tests and by the CLI's `audit` command. */
export function assertAuditRecordSafe(record: AuditRecord | Record<string, unknown>): void {
  const allowed = new Set<string>(AUDIT_FIELD_WHITELIST);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ContractError('unsafe_audit_record', `audit field "${key}" is outside the whitelist`);
    }
  }
}

export class MemoryAuditStore implements AuditStore {
  private readonly records: AuditRecord[] = [];

  append(record: AuditRecord): void {
    this.records.push(record);
  }

  query(query: AuditQuery = {}): AuditRecord[] {
    return filterRecords(this.records, query);
  }

  all(): readonly AuditRecord[] {
    return this.records;
  }
}

export class JsonlAuditStore implements AuditStore {
  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
  }

  append(record: AuditRecord): void {
    assertAuditRecordSafe(record);
    appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  query(query: AuditQuery = {}): AuditRecord[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const records: AuditRecord[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as AuditRecord);
      } catch {
        // A corrupt line must not take the whole audit trail down.
      }
    }
    return filterRecords(records, query);
  }
}

function filterRecords(records: readonly AuditRecord[], query: AuditQuery): AuditRecord[] {
  const sinceMs = query.since === undefined ? null : Date.parse(query.since);
  if (sinceMs !== null && Number.isNaN(sinceMs)) {
    throw new ContractError('invalid_audit_query', `since is not a valid date: ${String(query.since)}`);
  }

  let filtered = records.filter((record) => {
    if (sinceMs !== null && Date.parse(record.timestamp) < sinceMs) return false;
    if (query.policy_id !== undefined && record.policy_id !== query.policy_id) return false;
    return true;
  });

  if (query.limit !== undefined && query.limit >= 0) {
    filtered = filtered.slice(-query.limit);
  }
  return filtered;
}
