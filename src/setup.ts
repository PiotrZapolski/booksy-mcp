import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export type ClientId = 'claude-code' | 'codex' | 'claude-desktop';
export const CLIENT_IDS: ClientId[] = ['claude-code', 'codex', 'claude-desktop'];
const SERVER_NAME = 'booksy';

export interface ServerCommand {
  command: string;
  args: string[];
}

export interface SetupOptions {
  client: ClientId | 'all';
  dryRun: boolean;
  uninstall: boolean;
  open: boolean;
  extensionDir?: string;
}

export interface SetupEnv {
  home: string;
  platform: NodeJS.Platform;
  appData?: string;
  nodeVersion: string;
  /** Absolute path of the packaged extension (extension/dist). */
  packagedExtension: string;
  /** What MCP clients should run. */
  server: ServerCommand;
  which(name: string): string | null;
  exec(command: string, args: string[]): { ok: boolean; output: string };
  open(target: string): void;
  log(line: string): void;
}

export interface ClientReport {
  client: ClientId;
  status: 'configured' | 'removed' | 'unchanged' | 'not_found' | 'failed';
  detail: string;
}

export function parseSetupArgs(argv: string[]): SetupOptions | { error: string } {
  const options: SetupOptions = { client: 'all', dryRun: false, uninstall: false, open: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--uninstall') options.uninstall = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--client' || arg === '--extension-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { error: `${arg} needs a value.` };
      i += 1;
      if (arg === '--extension-dir') options.extensionDir = value;
      else if (value === 'all' || (CLIENT_IDS as string[]).includes(value)) {
        options.client = value as SetupOptions['client'];
      } else {
        return { error: `Unknown client "${value}". Use claude-code, codex, claude-desktop or all.` };
      }
    } else return { error: `Unknown option ${arg}.` };
  }
  return options;
}

export function claudeDesktopConfigPath(env: Pick<SetupEnv, 'home' | 'platform' | 'appData'>): string {
  if (env.platform === 'darwin') {
    return join(env.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (env.platform === 'win32') {
    return join(env.appData ?? join(env.home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return join(env.home, '.config', 'Claude', 'claude_desktop_config.json');
}

const codexConfigPath = (env: Pick<SetupEnv, 'home'>): string => join(env.home, '.codex', 'config.toml');

function backup(file: string): string | null {
  if (!existsSync(file)) return null;
  const copy = `${file}.booksy-mcp.bak`;
  copyFileSync(file, copy);
  return copy;
}

/** Removes the booksy table and its sub-tables from a TOML text. Other tables are kept as they are. */
export function removeCodexEntry(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (header) {
      const name = (header[1] as string).replaceAll('"', '');
      skipping = name === `mcp_servers.${SERVER_NAME}` || name.startsWith(`mcp_servers.${SERVER_NAME}.`);
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

export function codexEntry(server: ServerCommand): string {
  return (
    `[mcp_servers.${SERVER_NAME}]\n` +
    `command = ${JSON.stringify(server.command)}\n` +
    `args = [${server.args.map((arg) => JSON.stringify(arg)).join(', ')}]\n`
  );
}

export function updateCodexConfig(text: string, server: ServerCommand | null): string {
  const base = removeCodexEntry(text);
  if (!server) return base ? `${base}\n` : '';
  return `${base ? `${base}\n\n` : ''}${codexEntry(server)}`;
}

type DesktopConfig = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

export function updateDesktopConfig(text: string, server: ServerCommand | null): string {
  const config = (text.trim() ? JSON.parse(text) : {}) as DesktopConfig;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('the file is not a JSON object');
  }
  const servers = { ...(config.mcpServers ?? {}) };
  if (server) servers[SERVER_NAME] = { command: server.command, args: server.args };
  else delete servers[SERVER_NAME];
  const next = { ...config };
  if (server || Object.keys(servers).length > 0 || config.mcpServers !== undefined) {
    next.mcpServers = servers;
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

function setupFileClient(
  client: 'codex' | 'claude-desktop',
  file: string,
  env: SetupEnv,
  options: SetupOptions,
  detected: boolean,
): ClientReport {
  const exists = existsSync(file);
  if (!detected && !exists) {
    return { client, status: 'not_found', detail: 'not installed on this computer' };
  }
  if (options.uninstall && !exists) return { client, status: 'unchanged', detail: `no file at ${file}` };
  try {
    const before = exists ? readFileSync(file, 'utf8') : '';
    const server = options.uninstall ? null : env.server;
    const after =
      client === 'codex' ? updateCodexConfig(before, server) : updateDesktopConfig(before, server);
    if (after === before) return { client, status: 'unchanged', detail: `already up to date: ${file}` };
    const verb = options.uninstall ? 'would remove from' : 'would write';
    if (options.dryRun) return { client, status: 'unchanged', detail: `${verb} ${file}` };
    const saved = backup(file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, after);
    return {
      client,
      status: options.uninstall ? 'removed' : 'configured',
      detail: `${file}${saved ? ` (backup: ${saved})` : ''}`,
    };
  } catch (error) {
    return { client, status: 'failed', detail: `${file} not changed: ${(error as Error).message}` };
  }
}

function setupClaudeCode(env: SetupEnv, options: SetupOptions): ClientReport {
  const claude = env.which('claude');
  if (!claude) return { client: 'claude-code', status: 'not_found', detail: '"claude" is not on PATH' };
  const present = env.exec(claude, ['mcp', 'get', SERVER_NAME]).ok;
  if (options.uninstall) {
    if (!present) return { client: 'claude-code', status: 'unchanged', detail: 'server was not added' };
    if (options.dryRun) {
      return { client: 'claude-code', status: 'unchanged', detail: `would run: claude mcp remove ${SERVER_NAME} --scope user` };
    }
    const result = env.exec(claude, ['mcp', 'remove', SERVER_NAME, '--scope', 'user']);
    return {
      client: 'claude-code',
      status: result.ok ? 'removed' : 'failed',
      detail: result.ok ? 'removed from user scope' : result.output,
    };
  }
  const add = ['mcp', 'add', SERVER_NAME, '--scope', 'user', '--', env.server.command, ...env.server.args];
  if (options.dryRun) {
    return { client: 'claude-code', status: 'unchanged', detail: `would run: claude ${add.join(' ')}` };
  }
  backup(join(env.home, '.claude.json'));
  if (present) env.exec(claude, ['mcp', 'remove', SERVER_NAME, '--scope', 'user']);
  const result = env.exec(claude, add);
  return {
    client: 'claude-code',
    status: result.ok ? 'configured' : 'failed',
    detail: result.ok ? 'added in user scope (all folders)' : result.output,
  };
}

export function extensionDirectory(env: Pick<SetupEnv, 'home'>, options: SetupOptions): string {
  return resolve(options.extensionDir ?? join(env.home, 'booksy-mcp', 'extension'));
}

function setupExtension(env: SetupEnv, options: SetupOptions): { dir: string; ok: boolean; detail: string } {
  const dir = extensionDirectory(env, options);
  if (options.uninstall) {
    const ours = existsSync(join(dir, 'manifest.json')) && existsSync(join(dir, 'background.js'));
    if (!ours) return { dir, ok: true, detail: 'no extension folder to remove' };
    if (!options.dryRun) rmSync(dir, { recursive: true, force: true });
    return { dir, ok: true, detail: options.dryRun ? `would remove ${dir}` : `removed ${dir}` };
  }
  if (!existsSync(join(env.packagedExtension, 'manifest.json'))) {
    return { dir, ok: false, detail: 'the extension is not built. Run "npm run build" in the repository.' };
  }
  if (options.dryRun) return { dir, ok: true, detail: `would copy the extension to ${dir}` };
  mkdirSync(dir, { recursive: true });
  cpSync(env.packagedExtension, dir, { recursive: true });
  return { dir, ok: true, detail: `copied to ${dir}` };
}

function openChrome(env: SetupEnv, dir: string): void {
  try {
    env.open('chrome://extensions');
  } catch {
    /* Best effort. The next steps tell the user to open it by hand. */
  }
  try {
    env.open(dir);
  } catch {
    /* Same. */
  }
}

export function runSetup(options: SetupOptions, env: SetupEnv): number {
  const major = Number.parseInt(env.nodeVersion.replace(/^v/, ''), 10);
  if (major < 20) {
    env.log(`Node.js 20 or newer is required. This is ${env.nodeVersion}. Install a current Node.js and run setup again.`);
    return 1;
  }
  const targets = options.client === 'all' ? CLIENT_IDS : [options.client];
  const reports: ClientReport[] = [];
  for (const client of targets) {
    if (client === 'claude-code') reports.push(setupClaudeCode(env, options));
    else if (client === 'codex') {
      reports.push(setupFileClient('codex', codexConfigPath(env), env, options, existsSync(join(env.home, '.codex')) || env.which('codex') !== null));
    } else {
      const file = claudeDesktopConfigPath(env);
      reports.push(setupFileClient('claude-desktop', file, env, options, existsSync(dirname(file))));
    }
  }
  const extension = setupExtension(env, options);

  const prefix = options.dryRun ? '[dry run] ' : '';
  for (const report of reports) env.log(`${prefix}${report.client}: ${report.status}. ${report.detail}`);
  env.log(`${prefix}extension: ${extension.detail}`);

  const failed = reports.some((r) => r.status === 'failed') || !extension.ok;
  const changed = reports.filter((r) => r.status === 'configured' || r.status === 'removed');
  if (options.uninstall) {
    env.log('');
    env.log('Remove the extension in chrome://extensions (Booksy MCP Bridge, Remove), then restart your MCP client.');
    return failed ? 1 : 0;
  }
  if (options.dryRun) return failed ? 1 : 0;
  if (failed) return 1;
  if (changed.length === 0) {
    env.log('');
    env.log('No MCP client was configured. Install Claude Code, Codex or Claude Desktop, or choose one with --client.');
    return 1;
  }

  if (options.open) openChrome(env, extension.dir);
  env.log('');
  env.log('Next steps:');
  env.log('1. Chrome: open chrome://extensions, turn on "Developer mode" (top right).');
  env.log(`2. Click "Load unpacked" and pick this folder: ${extension.dir}`);
  env.log('3. Restart your MCP client (Claude Code: /mcp, then reconnect booksy; Codex and Claude Desktop: restart).');
  env.log('4. Open https://booksy.com/pro in Chrome and log in.');
  env.log('5. Ask your assistant to run session_status. It shows an 8-character pairing code.');
  env.log('6. Click the Booksy MCP Bridge icon in Chrome, enter the code and click Connect.');
  return 0;
}

function findOnPath(name: string, platform: NodeJS.Platform): string | null {
  const extensions = platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    if (!folder) continue;
    for (const extension of extensions) {
      const candidate = join(folder, `${name}${extension.toLowerCase()}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** npx runs from a cache that may be cleaned, so the clients should start the server through npx too. */
export function serverCommand(entry: string): ServerCommand {
  if (entry.includes('node_modules') || entry.includes('_npx')) {
    return { command: 'npx', args: ['-y', 'booksy-mcp'] };
  }
  return { command: process.execPath, args: [entry] };
}

export function realSetupEnv(entry: string, packagedExtension: string): SetupEnv {
  const platform = process.platform;
  const env: SetupEnv = {
    home: homedir(),
    platform,
    nodeVersion: process.version,
    packagedExtension,
    server: serverCommand(entry),
    which: (name) => findOnPath(name, platform),
    exec: (command, args) => {
      const result = spawnSync(command, args, { encoding: 'utf8', shell: platform === 'win32' });
      return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
    },
    open: (target) => {
      if (platform === 'darwin') {
        const args = target.startsWith('chrome://') ? ['-a', 'Google Chrome', target] : [target];
        spawnSync('open', args, { stdio: 'ignore' });
      } else if (platform === 'win32') {
        const args = target.startsWith('chrome://') ? ['/c', 'start', 'chrome', target] : ['/c', 'start', '', target];
        spawnSync('cmd', args, { stdio: 'ignore' });
      } else if (target.startsWith('chrome://')) {
        const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
          .map((name) => findOnPath(name, platform))
          .find((path) => path !== null);
        if (chrome) spawnSync(chrome, [target], { stdio: 'ignore' });
      } else {
        spawnSync('xdg-open', [target], { stdio: 'ignore' });
      }
    },
    log: (line) => process.stdout.write(`${line}\n`),
  };
  if (process.env.APPDATA) env.appData = process.env.APPDATA;
  return env;
}
