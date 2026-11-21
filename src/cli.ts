#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JsonlAuditStore, MemoryAuditStore, type AuditStore } from './audit/store.js';
import { COMPILE_TARGETS, compileAllTargets, compilePolicies, writeBundle, type CompileTarget } from './compile/index.js';
import { AgentGate } from './gate/index.js';
import { AgentGateError, errorMessage } from './errors.js';
import { normalizeEvent } from './events/normalize.js';
import { serveStdio } from './mcp/server.js';
import { loadPolicies } from './policy/load.js';
import { summarizePolicy } from './policy/summary.js';
import { validatePolicyDocument } from './policy/validate.js';
import type { Policy } from './policy/types.js';
import { createPetServer, listen, DEFAULT_PET_PORT } from './pet/http.js';
import { fixedClock, systemClock, type Clock } from './util/clock.js';
import { COMPILE_FORMAT_VERSION, ENGINE_VERSION } from './version.js';
import { verifyCompilation } from './compile/verify.js';
import { projectLifecycle } from './policy/lifecycle.js';

const HELP = `agent-gate v${ENGINE_VERSION}

用法:
  gate validate <policy.yaml|dir>...                校验策略文件
  gate list <policy.yaml|dir>...                    列出策略
  gate evaluate --policy <path>... --event <json|file> [--now <iso>] [--timezone <tz>]
  gate compile --policy <path>... --out <dir> [--target agents|skill|mcp|all]
  gate verify --policy <path>... [--target agents|skill|mcp|all]
  gate lifecycle --policy <path>... --audit <file> [--now <iso>]
  gate mcp --policy <path>... [--audit <file>]
  gate pet --policy <path>... [--port 3778] [--host 127.0.0.1] [--audit <file>]
  gate audit --audit <file> [--since <iso>] [--policy-id <id>] [--limit <n>]

说明:
  evaluate 读取一个事件（内联 JSON 或文件路径），输出决策与 signal。
  compile 把同一份策略编译成 AGENTS.md / SKILL.md / MCP bundle。
  verify 校验三个目标产物是否描述同一份策略集（编译一致性）。
  lifecycle 从审计记录投影每条策略的生命周期状态。
  mcp 启动无状态 stdio MCP server，供任意 Agent 调用。
  pet 启动本地 HTTP 桥，供宠物/呈现层订阅信号。
`;

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const withoutPrefix = arg.slice(2);
      const equals = withoutPrefix.indexOf('=');
      if (equals !== -1) {
        push(flags, withoutPrefix.slice(0, equals), withoutPrefix.slice(equals + 1));
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        push(flags, withoutPrefix, next);
        index += 1;
      } else {
        push(flags, withoutPrefix, 'true');
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

function push(flags: Map<string, string[]>, key: string, value: string): void {
  const current = flags.get(key);
  if (current === undefined) flags.set(key, [value]);
  else current.push(value);
}

function flagValues(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

function flag(parsed: ParsedArgs, key: string): string | undefined {
  return flagValues(parsed, key)[0];
}

function requiredFlag(parsed: ParsedArgs, key: string): string[] {
  const values = flagValues(parsed, key);
  if (values.length === 0) throw new UsageError(`缺少 --${key}`);
  return values;
}

class UsageError extends Error {}

function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  const command = parsed.positionals[0];

  // Flags win over positionals: `--version`/`--help` never need a subcommand.
  if (parsed.flags.has('version') || command === 'version') {
    process.stdout.write(`${ENGINE_VERSION}\n`);
    return 0;
  }
  if (command === undefined || command === 'help' || parsed.flags.has('help')) {
    process.stdout.write(HELP);
    return 0;
  }

  switch (command) {
    case 'validate':
      return commandValidate(parsed);
    case 'list':
      return commandList(parsed);
    case 'evaluate':
      return commandEvaluate(parsed);
    case 'compile':
      return commandCompile(parsed);
    case 'verify':
      return commandVerify(parsed);
    case 'lifecycle':
      return commandLifecycle(parsed);
    case 'mcp':
      return commandMcp(parsed);
    case 'pet':
      return commandPet(parsed);
    case 'audit':
      return commandAudit(parsed);
    default:
      throw new UsageError(`未知命令: ${command}`);
  }
}

function loadPolicyFiles(parsed: ParsedArgs): Policy[] {
  const paths = flagValues(parsed, 'policy');
  const positionalPaths = parsed.positionals.slice(1);
  const inputs = [...paths, ...positionalPaths];
  if (inputs.length === 0) throw new UsageError('缺少策略路径（--policy 或位置参数）');
  return loadPolicies(inputs).map((loaded) => loaded.policy);
}

function createAuditStore(parsed: ParsedArgs): AuditStore {
  const file = flag(parsed, 'audit');
  if (file === undefined) return new MemoryAuditStore();
  return new JsonlAuditStore(path.resolve(file));
}

function createClock(parsed: ParsedArgs): Clock {
  const now = flag(parsed, 'now');
  return now === undefined ? systemClock : fixedClock(now);
}

function commandValidate(parsed: ParsedArgs): number {
  const paths = parsed.positionals.slice(1);
  if (paths.length === 0) throw new UsageError('缺少策略路径');
  let failures = 0;
  for (const loaded of loadPolicies(paths)) {
    const result = validatePolicyDocument({ policy: loaded.policy }, loaded.file);
    if (result.valid) {
      process.stdout.write(`ok  ${loaded.file}  (${loaded.policy.id})\n`);
    } else {
      failures += 1;
      process.stderr.write(`fail ${loaded.file}\n`);
      for (const issue of result.issues) {
        process.stderr.write(`  ${issue.path} (${issue.code}): ${issue.message}\n`);
      }
    }
  }
  return failures === 0 ? 0 : 1;
}

function commandList(parsed: ParsedArgs): number {
  const policies = loadPolicyFiles(parsed);
  const rows = policies.map(summarizePolicy);
  process.stdout.write(`${rows.length} 条策略\n\n`);
  for (const row of rows) {
    process.stdout.write(
      `- ${row.id} v${row.version} [${row.decision}] priority=${row.priority} approval=${row.requires_approval}\n  ${row.description}\n`,
    );
  }
  return 0;
}

function commandEvaluate(parsed: ParsedArgs): number {
  const policies = loadPolicyFiles(parsed);
  const eventArg = flag(parsed, 'event');
  if (eventArg === undefined) throw new UsageError('缺少 --event');
  const raw = readJsonArgument(eventArg);
  const event = normalizeEvent(raw);

  const engine = new AgentGate({
    policies,
    audit: createAuditStore(parsed),
    clock: createClock(parsed),
    timezone: flag(parsed, 'timezone'),
  });

  const outcome = engine.evaluate(event);
  process.stdout.write(
    `${JSON.stringify(
      {
        decision: outcome.decision,
        matched_policy_id: outcome.matched_policy_id,
        degraded: outcome.degraded,
        throttled: outcome.throttled,
        signal: outcome.signal,
        warnings: outcome.warnings,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

function commandCompile(parsed: ParsedArgs): number {
  const policies = loadPolicyFiles(parsed);
  const outDir = flag(parsed, 'out');
  if (outDir === undefined) throw new UsageError('缺少 --out');

  const targets = resolveTargets(parsed);
  const absoluteOut = path.resolve(outDir);
  const bundles = compileAllTargets(policies, targets);

  const written: string[] = [];
  for (const bundle of bundles) {
    written.push(...writeBundle(bundle, absoluteOut));
  }

  // Refuse to ship a bundle whose targets disagree: an agent reading a stale
  // or lossy artifact is exactly the failure this project exists to prevent.
  const parity = verifyCompilation(policies, bundles);
  if (!parity.ok) reportParityFailure(parity);

  const manifest = {
    engine_version: ENGINE_VERSION,
    format_version: COMPILE_FORMAT_VERSION,
    source_hash: bundles[0]?.source_hash ?? null,
    targets,
    policies: policies.map((policy) => policy.id).sort(),
    files: written.map((file) => path.relative(absoluteOut, file).replace(/\\/g, '/')).sort(),
    // Per-target file hashes so a consumer can tell "which artifact is stale".
    artifacts: bundles.map((bundle) => ({
      target: bundle.target,
      source_hash: bundle.source_hash,
      files: bundle.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    })),
  };
  writeFileSync(path.join(absoluteOut, 'compile-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  for (const file of manifest.files) process.stdout.write(`${file}\n`);
  process.stdout.write(`source_hash ${manifest.source_hash}\n`);
  return 0;
}

function commandVerify(parsed: ParsedArgs): number {
  const policies = loadPolicyFiles(parsed);
  const targets = resolveTargets(parsed);
  const bundles = compileAllTargets(policies, targets);
  const report = verifyCompilation(policies, bundles);

  if (!report.ok) reportParityFailure(report);

  for (const [target, facts] of Object.entries(report.facts)) {
    process.stdout.write(`${target}: ${facts.length} 条策略，事实一致\n`);
  }
  process.stdout.write(`source_hash ${report.source_hash}\n`);
  process.stdout.write(`format_version ${report.format_version}\n`);
  process.stdout.write(
    targets.length === COMPILE_TARGETS.length
      ? '编译一致性通过：三个目标描述同一份策略集。\n'
      : `编译一致性通过：${targets.join(', ')} 描述同一份策略集。\n`,
  );
  return 0;
}

function commandLifecycle(parsed: ParsedArgs): number {
  const policies = loadPolicyFiles(parsed);
  const auditFile = flag(parsed, 'audit');
  if (auditFile === undefined) throw new UsageError('缺少 --audit');

  const store = new JsonlAuditStore(path.resolve(auditFile));
  const records = store.query();
  const nowArg = flag(parsed, 'now');
  const now = nowArg === undefined ? new Date() : new Date(nowArg);
  if (Number.isNaN(now.getTime())) throw new UsageError(`--now 不是合法时间: ${String(nowArg)}`);

  const projected = projectLifecycle(policies, records, now);
  process.stdout.write(
    `${JSON.stringify(
      projected.map((entry) => ({
        policy_id: entry.policy_id,
        state: entry.state,
        since: entry.since,
        consecutive_dismissals: entry.consecutive_dismissals,
        muted_until: entry.muted_until,
      })),
      null,
      2,
    )}\n`,
  );
  return 0;
}

function reportParityFailure(report: { issues: readonly { target: string; code: string; message: string }[] }): never {
  process.stderr.write('编译一致性检查失败:\n');
  for (const issue of report.issues) {
    process.stderr.write(`  ✖ [${issue.target}] ${issue.code}: ${issue.message}\n`);
  }
  // A parity failure is not a usage mistake: exit 1, no help text.
  process.exitCode = 1;
  throw new ParityFailure(`${report.issues.length} 项编译一致性问题`);
}

/** Internal: distinguishes a failed check from a malformed command line. */
class ParityFailure extends Error {}

function resolveTargets(parsed: ParsedArgs): readonly CompileTarget[] {
  const targetArg = flag(parsed, 'target') ?? 'all';
  return targetArg === 'all' ? COMPILE_TARGETS : isCompileTarget(targetArg) ? [targetArg] : invalidTarget(targetArg);
}

function isCompileTarget(value: string): value is CompileTarget {
  return (COMPILE_TARGETS as readonly string[]).includes(value);
}

function invalidTarget(value: string): never {
  throw new UsageError(`未知编译目标: ${value}（可选 ${COMPILE_TARGETS.join('|')}|all）`);
}

function commandMcp(parsed: ParsedArgs): number {
  const policies = loadPolicyFiles(parsed);
  const engine = new AgentGate({ policies, audit: createAuditStore(parsed), clock: systemClock });
  const server = serveStdio(engine);
  void server.done.then(() => process.exit(0));
  return 0;
}

function commandPet(parsed: ParsedArgs): number {
  const policies = loadPolicyFiles(parsed);
  const engine = new AgentGate({ policies, audit: createAuditStore(parsed), clock: systemClock });
  const port = Number(flag(parsed, 'port') ?? DEFAULT_PET_PORT);
  const host = flag(parsed, 'host') ?? '127.0.0.1';
  const pet = createPetServer({ engine });

  listen(pet.server, host, port)
    .then(() => {
      process.stdout.write(`gate pet bridge on ${pet.url()}\n`);
      process.stdout.write('  POST /v1/events · POST /v1/signals/:id/respond · GET /v1/signals/pending · GET /healthz\n');
      if (flag(parsed, 'audit') === undefined) {
        process.stdout.write('  (audit 仅存内存，重启即丢；用 --audit <file> 落盘)\n');
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exit(1);
    });
  return 0;
}

function commandAudit(parsed: ParsedArgs): number {
  const file = flag(parsed, 'audit');
  if (file === undefined) throw new UsageError('缺少 --audit');
  const store = new JsonlAuditStore(path.resolve(file));
  const query: { since?: string; policy_id?: string; limit?: number } = {};
  const since = flag(parsed, 'since');
  if (since !== undefined) query.since = since;
  const policyId = flag(parsed, 'policy-id');
  if (policyId !== undefined) query.policy_id = policyId;
  const limit = flag(parsed, 'limit');
  if (limit !== undefined) query.limit = Number(limit);

  const records = store.query(query);
  for (const record of records) process.stdout.write(`${JSON.stringify(record)}\n`);
  process.stdout.write(`${records.length} 条审计记录\n`);
  return 0;
}

function readJsonArgument(argument: string): unknown {
  const trimmed = argument.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as unknown;
  return JSON.parse(readFileSync(path.resolve(argument), 'utf8')) as unknown;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`usage: ${error.message}\n\n${HELP}`);
      process.exitCode = 2;
    } else if (error instanceof ParityFailure) {
      // The issue list is already on stderr; a check failure is exit 1, not 2.
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } else if (error instanceof AgentGateError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  }
}

export { main };
