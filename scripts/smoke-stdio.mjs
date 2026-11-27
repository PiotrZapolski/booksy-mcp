// Starts an MCP server command and checks that it answers initialize and tools/list on stdio.
// No browser is needed for this: it is what registries and directories do to inspect the server.
//   node scripts/smoke-stdio.mjs node dist/index.js
//   node scripts/smoke-stdio.mjs docker run --rm -i booksy-mcp
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/smoke-stdio.mjs <command> [args...]');
  process.exit(1);
}

const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
const timer = setTimeout(() => fail('no answer within 30 s'), 30_000);

function fail(reason) {
  console.error(`smoke-stdio: ${reason}`);
  child.kill();
  process.exit(1);
}

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (line) onMessage(JSON.parse(line));
  }
});
child.on('error', (error) => fail(error.message));
child.on('exit', (code) => {
  if (!done) fail(`the server exited with code ${code} before answering`);
});

let done = false;
function onMessage(message) {
  if (message.error) fail(JSON.stringify(message.error));
  if (message.id === 1) {
    const name = message.result?.serverInfo?.name;
    if (!name) fail('initialize returned no serverInfo');
    process.stdout.write(`initialize ok: ${name} ${message.result.serverInfo.version}\n`);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  } else if (message.id === 2) {
    const tools = message.result?.tools ?? [];
    if (tools.length === 0) fail('tools/list returned no tools');
    process.stdout.write(`tools/list ok: ${tools.length} tools\n`);
    done = true;
    clearTimeout(timer);
    child.stdin.end();
  }
}

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-stdio', version: '1' },
  },
});
