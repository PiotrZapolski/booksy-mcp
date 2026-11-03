#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pairing } from './bridge/pairing.js';
import { RelayBridge } from './bridge/relay.js';
import { BridgeServer } from './bridge/server.js';
import { loadConfig, SAFE_MODE_OFF_WARNING } from './config.js';
import { Gateway } from './gateway/gateway.js';
import { TrafficLedger } from './gateway/ledger.js';
import { JOB_EXIT, JOB_HELP, parseJobArgs, runJob } from './job.js';
import { createServer, ledgerPath, SERVER_VERSION } from './server.js';
import { parseSetupArgs, realSetupEnv, runSetup } from './setup.js';

const HELP = `booksy-mcp ${SERVER_VERSION}

  booksy-mcp                     Start the MCP server on stdio (what MCP clients run).
  booksy-mcp setup               Add the server to your MCP clients and unpack the extension.
                                 Options: --client claude-code|codex|claude-desktop|all,
                                 --dry-run, --uninstall, --no-open, --extension-dir <folder>.
  booksy-mcp extension [folder]  Copy the browser extension to a folder and print the path.
  booksy-mcp job [options]       Save reports and the staff schedule without an MCP client, for a
                                 scheduled task. See "booksy-mcp job --help".
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

/**
 * A scheduled job. It takes the bridge port itself, or, when an MCP server already holds it,
 * connects to that server as a relay. Either way there is one pairing and one extension connection.
 */
const JOB_CONNECT_WAIT_MS = 45_000;

async function job(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(JOB_HELP);
    return;
  }
  const options = parseJobArgs(args);
  if ('error' in options) {
    console.error(`${options.error}\n\n${JOB_HELP}`);
    process.exit(JOB_EXIT.nothing);
  }
  const config = loadConfig();
  const pairing = new Pairing(join(config.configDir, 'bridge-secret'));
  const log = (line: string): void => console.error(`booksy-mcp job: ${line}`);
  // The extension's service worker may be asleep and wakes up at least every 30 s to reconnect.
  const server = new BridgeServer(
    { port: config.port, extensionIds: config.extensionIds, connectWaitMs: JOB_CONNECT_WAIT_MS },
    pairing,
  );
  await server.start();
  let bridge: BridgeServer | RelayBridge = server;
  let stop = (): Promise<void> => server.stop();
  if (server.status().portBusy) {
    const relay = new RelayBridge({ port: config.port }, pairing);
    try {
      await relay.connect();
      log(`port ${config.port} is held by a running booksy-mcp, working through it`);
      bridge = relay;
      stop = () => relay.stop();
    } catch (error) {
      log((error as Error).message);
    }
  }
  if (!config.traffic.safeMode) log(`WARNING. ${SAFE_MODE_OFF_WARNING}`);
  const gateway = new Gateway(bridge, {
    traffic: config.traffic,
    redactPii: config.redactPii,
    ledgerPath: ledgerPath(config),
  });
  let code: number = JOB_EXIT.nothing;
  try {
    const summary = await runJob(options, { gateway, log });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    code = summary.exit_code;
  } finally {
    await stop();
  }
  process.exit(code);
}

function setup(args: string[]): void {
  const options = parseSetupArgs(args);
  if ('error' in options) {
    console.error(`${options.error}\n\n${HELP}`);
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const env = realSetupEnv(fileURLToPath(import.meta.url), join(root, 'extension', 'dist'));
  process.exit(runSetup(options, env));
}

const [command, argument] = process.argv.slice(2);

if (command === '--help' || command === '-h') {
  process.stdout.write(HELP);
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${SERVER_VERSION}\n`);
} else if (command === 'setup') {
  setup(process.argv.slice(3));
} else if (command === 'job') {
  await job(process.argv.slice(3));
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
