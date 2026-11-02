#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pairing } from './bridge/pairing.js';
import { BridgeServer } from './bridge/server.js';
import { loadConfig, SAFE_MODE_OFF_WARNING } from './config.js';
import { TrafficLedger } from './gateway/ledger.js';
import { createServer, ledgerPath, SERVER_VERSION } from './server.js';

const HELP = `booksy-mcp ${SERVER_VERSION}

  booksy-mcp                     Start the MCP server on stdio (what MCP clients run).
  booksy-mcp extension [folder]  Copy the browser extension to a folder and print the path.
  booksy-mcp reset-pairing       Forget the paired extension.
  booksy-mcp reset-cooldown      End a stop after a block. First check the panel works by hand.
  booksy-mcp --version           Print the version.
`;

function installExtension(target: string | undefined): void {
  const config = loadConfig();
  const packaged = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'dist');
  if (!existsSync(packaged)) {
    console.error('The extension is not built. Run "npm run build" in this repository.');
    process.exit(1);
  }
  const folder = resolve(target ?? join(config.configDir, 'extension'));
  cpSync(packaged, folder, { recursive: true });
  process.stdout.write(`${folder}\n`);
}

async function serve(): Promise<void> {
  const config = loadConfig();
  const pairing = new Pairing(join(config.configDir, 'bridge-secret'));
  const bridge = new BridgeServer(
    { port: config.port, extensionIds: config.extensionIds },
    pairing,
  );
  await bridge.start();
  const { server } = createServer(bridge, config);

  if (!config.traffic.safeMode) console.error(`booksy-mcp: WARNING. ${SAFE_MODE_OFF_WARNING}`);
  const status = bridge.status();
  if (status.portBusy) {
    console.error(`booksy-mcp: port ${config.port} is busy. Tools will explain how to fix it.`);
  } else if (status.pairingCode) {
    console.error(`booksy-mcp: pairing code ${status.pairingCode}`);
  }

  const shutdown = async (): Promise<void> => {
    await bridge.stop();
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.stdin.once('close', () => void shutdown());

  await server.connect(new StdioServerTransport());
}

const [command, argument] = process.argv.slice(2);

if (command === '--help' || command === '-h') {
  process.stdout.write(HELP);
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${SERVER_VERSION}\n`);
} else if (command === 'extension') {
  installExtension(argument);
} else if (command === 'reset-pairing') {
  new Pairing(join(loadConfig().configDir, 'bridge-secret')).reset();
  process.stdout.write('Pairing removed. Restart your MCP client to get a new code.\n');
} else if (command === 'reset-cooldown') {
  new TrafficLedger(ledgerPath(loadConfig())).clearBlock();
  process.stdout.write('Cooldown cleared. Use the tools gently, Booksy may still be limiting you.\n');
} else if (command === undefined) {
  await serve();
} else {
  console.error(`Unknown command: ${command}\n\n${HELP}`);
  process.exit(1);
}
