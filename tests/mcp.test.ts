import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { AgentGate } from '../src/gate/index.js';
import { McpServer, serveStdio, TOOL_NAMES } from '../src/mcp/server.js';
import type { JsonRpcResponse } from '../src/mcp/server.js';
import { makeAudit, makePolicies } from './mcp-fixtures.js';
import { NOW } from './helpers.js';

function newServer() {
  const audit = makeAudit();
  const engine = new AgentGate({
    policies: makePolicies(),
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: 'Asia/Shanghai',
  });
  return { server: new McpServer(engine), engine, audit };
}

const EVALUATE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'gate/evaluate',
    arguments: {
      event: {
        type: 'focus_block_started',
        timestamp: NOW,
        source: 'manual',
        context: { app: 'Code', project: 'agent-gate' },
      },
    },
  },
};

test('initialize advertises the protocol version and tool capability', async () => {
  const { server } = newServer();
  const response = (await server.handle({
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: { protocolVersion: '2026-07-28', clientInfo: { name: 'test', version: '0' } },
  })) as JsonRpcResponse;

  const result = response.result as {
    protocolVersion: string;
    capabilities: { tools: { listChanged: boolean } };
    serverInfo: { name: string; version: string };
  };
  assert.equal(result.protocolVersion, '2026-07-28');
  assert.equal(result.capabilities.tools.listChanged, false);
  assert.equal(result.serverInfo.name, 'agent-gate');
  assert.equal(result.serverInfo.version, '0.1.0');
});

test('notifications never receive a response', async () => {
  const { server } = newServer();
  const response = await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(response, null);
});

test('tools/list exposes exactly the compiled surface', async () => {
  const { server } = newServer();
  const response = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as JsonRpcResponse;
  const result = response.result as { tools: { name: string; inputSchema?: unknown }[] };

  assert.deepEqual(
    result.tools.map((tool) => tool.name).sort(),
    [...TOOL_NAMES].sort(),
  );

  const evaluate = result.tools.find((tool) => tool.name === 'gate/evaluate');
  assert.ok(evaluate?.inputSchema !== undefined);
});

test('gate/evaluate returns a signal for a matching policy', async () => {
  const { server } = newServer();
  const response = (await server.handle(EVALUATE_REQUEST)) as JsonRpcResponse;
  const result = response.result as {
    isError: boolean;
    structuredContent: { decision: string; signal: { policy_id: string; presentation: { bubble_text: string } } | null };
  };

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.decision, 'require_approval');
  assert.equal(result.structuredContent.signal?.policy_id, 'mcp-focus');
  assert.equal(result.structuredContent.signal?.presentation.bubble_text, '进入专注？');
});

test('gate/evaluate turns contract failures into isError results, not crashes', async () => {
  const { server } = newServer();
  const response = (await server.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'gate/evaluate', arguments: { event: { type: 'nope' } } },
  })) as JsonRpcResponse;

  const result = response.result as { isError: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /invalid_event/);
});

test('gate/list-policies and gate/audit-query answer from engine state', async () => {
  const { server } = newServer();
  await server.handle(EVALUATE_REQUEST);

  const listResponse = (await server.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'gate/list-policies', arguments: {} },
  })) as JsonRpcResponse;
  const list = listResponse.result as { structuredContent: { policies: { id: string }[] } };
  assert.deepEqual(
    list.structuredContent.policies.map((policy) => policy.id),
    ['mcp-focus'],
  );

  const auditResponse = (await server.handle({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'gate/audit-query', arguments: {} },
  })) as JsonRpcResponse;
  const records = auditResponse.result as { structuredContent: { records: { policy_id: string }[] } };
  assert.equal(records.structuredContent.records[0]?.policy_id, 'mcp-focus');
});

test('server/discover advertises a stateless server', async () => {
  const { server } = newServer();
  const response = (await server.handle({ jsonrpc: '2.0', id: 6, method: 'server/discover' })) as JsonRpcResponse;
  const result = response.result as { stateless: boolean; tools: string[]; policies: number };

  assert.equal(result.stateless, true);
  assert.equal(result.policies, 1);
  assert.deepEqual([...result.tools].sort(), [...TOOL_NAMES].sort());
});

test('unknown methods and malformed envelopes get JSON-RPC errors', async () => {
  const { server } = newServer();

  const unknown = (await server.handle({ jsonrpc: '2.0', id: 7, method: 'nope/nope' })) as JsonRpcResponse;
  assert.equal(unknown.error?.code, -32601);

  const malformed = (await server.handle({ id: 8, method: 'ping' })) as JsonRpcResponse;
  assert.equal(malformed.error?.code, -32600);

  const badTool = (await server.handle({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'gate/nope' },
  })) as JsonRpcResponse;
  assert.equal(badTool.error?.code, -32602);
});

test('serveStdio speaks newline-delimited JSON and supports batches', async () => {
  const audit = makeAudit();
  const engine = new AgentGate({
    policies: makePolicies(),
    audit,
    clock: { now: () => new Date(NOW) },
    timezone: 'Asia/Shanghai',
  });

  const input = new PassThrough();
  const output = new PassThrough();
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
  });

  const stdio = serveStdio(engine, { input, output });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  input.write(`${JSON.stringify([{ jsonrpc: '2.0', id: 2, method: 'ping' }, { jsonrpc: '2.0', id: 3, method: 'tools/list' }])}\n`);
  input.write('not json\n');
  input.end();
  await stdio.done;

  const lines = buffer
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as JsonRpcResponse);

  assert.equal(lines.length, 4);
  assert.ok(lines.some((line) => line.id === 1 && line.result !== undefined));
  assert.ok(lines.some((line) => line.id === 2 && line.result !== undefined));
  assert.ok(lines.some((line) => line.id === 3));
  assert.ok(lines.some((line) => line.error?.code === -32700));
});
