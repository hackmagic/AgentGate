// Interop smoke test: drive the built server with the official MCP SDK client
// over stdio, exactly like a real host would.
//
// The SDK is NOT a project dependency (the runtime ships zero MCP deps), so
// install it ad hoc before running:
//
//   npm i --no-save @modelcontextprotocol/sdk
//   npm run build
//   node scripts/mcp-interop.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/cli.js', 'mcp', '--policy', 'packs/deep-work'],
  stderr: 'inherit',
});

const client = new Client({ name: 'interop-probe', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);
console.log('connected:', client.getServerVersion());

const tools = await client.listTools();
console.log('tools:', tools.tools.map((tool) => tool.name).join(', '));

const result = await client.callTool({
  name: 'guidance/list-policies',
  arguments: {},
});
console.log('list-policies isError:', result.isError);
const listed = JSON.parse(result.content.at(-1).text.split('\n').at(-1));
console.log('policy ids:', listed.policies.map((policy) => policy.id).join(', '));

const audit = await client.callTool({ name: 'guidance/audit-query', arguments: {} });
console.log('audit-query isError:', audit.isError);

await client.close();
console.log('ok: official SDK completed a full session');
