import { randomUUID } from 'node:crypto';

import { ContractError } from '../errors.js';
import type { EventContext, AgentEvent } from './types.js';

/** Subset of an ActivityWatch event row used by the adapter. */
export interface ActivityWatchRow {
  timestamp: string;
  duration: number;
  data: {
    app?: string;
    title?: string;
    project?: string;
    status?: string;
  };
}

export interface ActivityWatchBucket {
  id?: string;
  type?: string;
  client?: string;
  events?: ActivityWatchRow[];
}

export interface ActivityWatchOptions {
  /** A run of the same app+project must last this long to open a focus block. */
  focus_block_minutes?: number;
  /** Consecutive rows may be separated by at most this many seconds. */
  gap_tolerance_seconds?: number;
  /** An AFK row must last at least this long to count as idle. */
  idle_minutes?: number;
  /** Override project extraction; return null when the title is inconclusive. */
  project_resolver?: (row: ActivityWatchRow) => string | null;
  /** Override language extraction from the window title. */
  language_resolver?: (row: ActivityWatchRow) => string | null;
  id_factory?: () => string;
}

const DEFAULTS = {
  focus_block_minutes: 25,
  gap_tolerance_seconds: 120,
  idle_minutes: 5,
} as const;

const WINDOW_CLIENTS = new Set(['aw-watcher-window', 'aw-watcher-window-x11', 'aw-watcher-window-macos']);
const AFK_CLIENTS = new Set(['aw-watcher-afk', 'aw-watcher-afk-x11', 'aw-watcher-afk-macos']);

const VSCODE_APPS = new Set(['code', 'code - insiders', 'cursor', 'windsurf', 'vscodium']);
const TERMINAL_APPS = new Set([
  'terminal',
  'iterm2',
  'iterm',
  'alacritty',
  'kitty',
  'wezterm',
  'windows terminal',
  'powershell',
  'cmd.exe',
  'gnome-terminal',
  'konsole',
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  md: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  vue: 'vue',
  svelte: 'svelte',
};

/**
 * Convert an ActivityWatch export (array of buckets) into agent-gate events.
 *
 * Emits `app_switch`, `focus_block_started`, `focus_block_ended` and
 * `idle_detected`. Events are ordered by timestamp; the export itself is
 * accepted either as a bucket array, a single bucket, or `{ buckets: [] }`.
 */
export function eventsFromActivityWatch(input: unknown, options: ActivityWatchOptions = {}): AgentEvent[] {
  const settings = {
    focus_block_minutes: options.focus_block_minutes ?? DEFAULTS.focus_block_minutes,
    gap_tolerance_seconds: options.gap_tolerance_seconds ?? DEFAULTS.gap_tolerance_seconds,
    idle_minutes: options.idle_minutes ?? DEFAULTS.idle_minutes,
  };
  if (settings.focus_block_minutes <= 0) throw new RangeError('focus_block_minutes must be > 0');
  if (settings.gap_tolerance_seconds < 0) throw new RangeError('gap_tolerance_seconds must be >= 0');
  if (settings.idle_minutes <= 0) throw new RangeError('idle_minutes must be > 0');

  const buckets = readBuckets(input);
  const idFactory = options.id_factory ?? randomUUID;
  const projectResolver = options.project_resolver ?? defaultProjectResolver;
  const languageResolver = options.language_resolver ?? defaultLanguageResolver;

  const windowRows = collectRows(buckets, (bucket) => isWindowBucket(bucket));
  const afkRows = collectRows(buckets, (bucket) => isAfkBucket(bucket));

  const ordered = [...windowRows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const events: AgentEvent[] = [];

  const runs = buildRuns(ordered, settings.gap_tolerance_seconds);
  let previousRun: Run | null = null;

  for (const run of runs) {
    const started = new Date(run.start);
    const ended = new Date(run.end);
    const blockSeconds = Math.max(0, (ended.getTime() - started.getTime()) / 1000);
    const context: EventContext = {
      app: run.app,
      project: projectResolver({ timestamp: run.rows[0]?.timestamp ?? run.start, duration: blockSeconds, data: { app: run.app, title: run.title } }),
      language: languageResolver({ timestamp: run.rows[0]?.timestamp ?? run.start, duration: blockSeconds, data: { app: run.app, title: run.title } }),
    };

    if (previousRun !== null && previousRun.app !== run.app) {
      events.push({
        id: idFactory(),
        type: 'app_switch',
        timestamp: started.toISOString(),
        source: 'activitywatch',
        context,
        duration_seconds: null,
        metrics: {},
        metadata: { from_app: previousRun.app, to_app: run.app },
      });
    }

    if (blockSeconds >= settings.focus_block_minutes * 60) {
      events.push({
        id: idFactory(),
        type: 'focus_block_started',
        timestamp: started.toISOString(),
        source: 'activitywatch',
        context,
        duration_seconds: roundSeconds(blockSeconds),
        metrics: {},
        metadata: { rows: run.rows.length },
      });
      events.push({
        id: idFactory(),
        type: 'focus_block_ended',
        timestamp: ended.toISOString(),
        source: 'activitywatch',
        context,
        duration_seconds: roundSeconds(blockSeconds),
        metrics: {},
        metadata: { rows: run.rows.length },
      });
    }

    previousRun = run;
  }

  for (const row of afkRows) {
    if ((row.data.status ?? '').toLowerCase() !== 'afk') continue;
    if (row.duration < settings.idle_minutes * 60) continue;
    const started = new Date(row.timestamp);
    events.push({
      id: idFactory(),
      type: 'idle_detected',
      timestamp: started.toISOString(),
      source: 'activitywatch',
      context: { app: row.data.app ?? 'unknown', project: null, language: null },
      duration_seconds: roundSeconds(row.duration),
      metrics: {},
      metadata: { status: row.data.status },
    });
  }

  return events.sort((a, b) => compareEvents(a, b));
}

interface Run {
  app: string;
  title: string;
  start: string;
  end: string;
  rows: ActivityWatchRow[];
}

function compareEvents(a: AgentEvent, b: AgentEvent): number {
  const byTime = Date.parse(a.timestamp) - Date.parse(b.timestamp);
  if (byTime !== 0) return byTime;
  return a.type.localeCompare(b.type);
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readBuckets(input: unknown): ActivityWatchBucket[] {
  if (Array.isArray(input)) {
    return input.map((bucket, index) => asBucket(bucket, index));
  }
  if (isObject(input) && Array.isArray(input.buckets)) {
    return input.buckets.map((bucket, index) => asBucket(bucket, index));
  }
  if (isObject(input) && Array.isArray(input.events)) {
    return [asBucket(input, 0)];
  }
  throw new ContractError('invalid_activitywatch_export', 'expected an ActivityWatch bucket array');
}

function asBucket(value: unknown, index: number): ActivityWatchBucket {
  if (!isObject(value) || !Array.isArray(value.events)) {
    throw new ContractError('invalid_activitywatch_export', `bucket ${index} has no events array`);
  }
  return value as unknown as ActivityWatchBucket;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWindowBucket(bucket: ActivityWatchBucket): boolean {
  if (bucket.type === 'currentwindow') return true;
  if (bucket.client !== undefined && WINDOW_CLIENTS.has(bucket.client)) return true;
  return bucket.events?.some((row) => typeof row.data?.app === 'string' && typeof row.data?.status !== 'string') ?? false;
}

function isAfkBucket(bucket: ActivityWatchBucket): boolean {
  if (bucket.type === 'afkstatus') return true;
  if (bucket.client !== undefined && AFK_CLIENTS.has(bucket.client)) return true;
  return bucket.events?.some((row) => typeof row.data?.status === 'string') ?? false;
}

function collectRows(buckets: readonly ActivityWatchBucket[], predicate: (bucket: ActivityWatchBucket) => boolean): ActivityWatchRow[] {
  const rows: ActivityWatchRow[] = [];
  for (const bucket of buckets) {
    if (!predicate(bucket)) continue;
    for (const row of bucket.events ?? []) {
      if (typeof row.timestamp !== 'string' || typeof row.duration !== 'number') continue;
      if (Number.isNaN(Date.parse(row.timestamp))) continue;
      rows.push(row);
    }
  }
  return rows;
}

function buildRuns(rows: readonly ActivityWatchRow[], gapToleranceSeconds: number): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;

  for (const row of rows) {
    const app = (row.data.app ?? '').trim();
    if (app === '') continue;
    const title = row.data.title ?? '';
    const start = new Date(row.timestamp);
    const end = new Date(start.getTime() + Math.max(0, row.duration) * 1000);

    if (current !== null && current.app === app) {
      const currentEnd = new Date(current.end);
      const gapSeconds = (start.getTime() - currentEnd.getTime()) / 1000;
      if (gapSeconds <= gapToleranceSeconds) {
        current.end = end.toISOString();
        current.rows.push(row);
        if (title.length > 0) current.title = title;
        continue;
      }
    }

    current = {
      app,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      rows: [row],
    };
    runs.push(current);
  }

  return runs;
}

/**
 * Best-effort project extraction. Deliberately conservative: an inconclusive
 * title yields null rather than a guess that would silently widen a policy.
 */
export function defaultProjectResolver(row: ActivityWatchRow): string | null {
  const explicit = row.data.project?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;

  const title = row.data.title?.trim() ?? '';
  if (title === '') return null;

  const app = (row.data.app ?? '').toLowerCase();
  const segments = title
    .split(/\s+[-–—]\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (VSCODE_APPS.has(app)) {
    if (segments.length >= 3) {
      const candidate = segments[segments.length - 2];
      return candidate !== undefined && candidate !== '' ? candidate : null;
    }
    return null;
  }

  if (TERMINAL_APPS.has(app)) {
    const marker = title.match(/(?:^|\s)(~?\/[^\s:—–]+)/);
    const path = marker?.[1];
    if (path === undefined) return null;
    const parts = path.split('/').filter((part) => part.length > 0);
    const last = parts[parts.length - 1];
    if (last === undefined || last === '~' || last === '.') return null;
    return last;
  }

  return null;
}

/** Map a file extension inside the window title to a language identifier. */
export function defaultLanguageResolver(row: ActivityWatchRow): string | null {
  const title = row.data.title ?? '';
  const match = title.match(/\.([a-z0-9]+)(?![a-z0-9])/i);
  if (match === null) return null;
  const extension = match[1]?.toLowerCase();
  if (extension === undefined) return null;
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}
