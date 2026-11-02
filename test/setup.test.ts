import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeDesktopConfigPath,
  parseSetupArgs,
  runSetup,
  serverCommand,
  type SetupEnv,
  type SetupOptions,
  updateCodexConfig,
} from '../src/setup.js';
import { tempDir } from './helpers.js';

const SERVER = { command: 'node', args: ['/x/dist/index.js'] };

function fixture(extra: Partial<SetupEnv> = {}) {
  const home = tempDir();
  const packaged = join(tempDir(), 'dist');
  mkdirSync(packaged, { recursive: true });
  writeFileSync(join(packaged, 'manifest.json'), '{}');
  writeFileSync(join(packaged, 'background.js'), '//');
  const log: string[] = [];
  const calls: string[][] = [];
  const opened: string[] = [];
  const env: SetupEnv = {
    home,
    platform: 'linux',
    nodeVersion: 'v22.1.0',
    packagedExtension: packaged,
    server: SERVER,
    which: () => null,
    exec: (_command, args) => {
      calls.push(args);
      return { ok: args[1] !== 'get', output: '' };
    },
    open: (target) => opened.push(target),
    log: (line) => log.push(line),
    ...extra,
  };
  return { env, home, log, calls, opened };
}

const base: SetupOptions = { client: 'all', dryRun: false, uninstall: false, open: true };

describe('arguments', () => {
  it('parses flags and rejects unknown ones', () => {
    expect(parseSetupArgs(['--client', 'codex', '--dry-run'])).toMatchObject({ client: 'codex', dryRun: true });
    expect(parseSetupArgs(['--uninstall'])).toMatchObject({ uninstall: true });
    expect(parseSetupArgs(['--client', 'vim'])).toHaveProperty('error');
    expect(parseSetupArgs(['--bogus'])).toHaveProperty('error');
    expect(parseSetupArgs(['--client'])).toHaveProperty('error');
  });

  it('starts through npx when run from node_modules or the npx cache', () => {
    expect(serverCommand('/h/.npm/_npx/abc/node_modules/booksy-mcp/dist/index.js').command).toBe('npx');
    expect(serverCommand('/h/booksy-mcp/dist/index.js').args).toEqual(['/h/booksy-mcp/dist/index.js']);
  });

  it('finds the Claude Desktop file per platform', () => {
    const home = '/h';
    expect(claudeDesktopConfigPath({ home, platform: 'darwin' })).toContain('Library/Application Support/Claude');
    expect(claudeDesktopConfigPath({ home, platform: 'win32', appData: 'C:\\A' })).toContain('Claude');
    expect(claudeDesktopConfigPath({ home, platform: 'linux' })).toBe('/h/.config/Claude/claude_desktop_config.json');
  });
});

describe('codex config', () => {
  it('keeps other servers and replaces only booksy', () => {
    const before = [
      'model = "x"',
      '',
      '[mcp_servers.other]',
      'command = "o"',
      '',
      '[mcp_servers.booksy]',
      'command = "old"',
      'args = ["a"]',
      '',
      '[mcp_servers.booksy.env]',
      'A = "1"',
      '',
      '[projects.p]',
      'trust = "yes"',
      '',
    ].join('\n');
    const after = updateCodexConfig(before, SERVER);
    expect(after).toContain('[mcp_servers.other]\ncommand = "o"');
    expect(after).toContain('[projects.p]\ntrust = "yes"');
    expect(after).not.toContain('"old"');
    expect(after).not.toContain('booksy.env');
    expect(after.match(/\[mcp_servers\.booksy\]/g)).toHaveLength(1);
    expect(after).toContain('args = ["/x/dist/index.js"]');
  });

  it('removes the entry cleanly', () => {
    const added = updateCodexConfig('model = "x"\n', SERVER);
    expect(updateCodexConfig(added, null)).toBe('model = "x"\n');
  });
});

describe('setup', () => {
  it('writes Codex and Claude Desktop, backs up, keeps foreign entries, copies the extension', () => {
    const { env, home, log, opened } = fixture();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers.keep]\ncommand = "k"\n');
    const desktop = claudeDesktopConfigPath(env);
    mkdirSync(join(desktop, '..'), { recursive: true });
    writeFileSync(desktop, JSON.stringify({ theme: 'dark', mcpServers: { keep: { command: 'k' } } }));

    expect(runSetup(base, env)).toBe(0);

    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.keep]');
    expect(toml).toContain('[mcp_servers.booksy]');
    expect(existsSync(join(home, '.codex', 'config.toml.booksy-mcp.bak'))).toBe(true);
    const json = JSON.parse(readFileSync(desktop, 'utf8'));
    expect(json.theme).toBe('dark');
    expect(json.mcpServers.keep).toEqual({ command: 'k' });
    expect(json.mcpServers.booksy).toEqual(SERVER);
    expect(existsSync(`${desktop}.booksy-mcp.bak`)).toBe(true);
    expect(existsSync(join(home, 'booksy-mcp', 'extension', 'manifest.json'))).toBe(true);
    expect(opened).toEqual(['chrome://extensions', join(home, 'booksy-mcp', 'extension')]);
    expect(log.join('\n')).toContain('Load unpacked');
    expect(log.join('\n')).toContain(join(home, 'booksy-mcp', 'extension'));
  });

  it('adds to Claude Code through its CLI in user scope', () => {
    const { env, calls } = fixture({ which: (name) => (name === 'claude' ? '/bin/claude' : null) });
    expect(runSetup({ ...base, client: 'claude-code' }, env)).toBe(0);
    expect(calls.at(-1)).toEqual(['mcp', 'add', 'booksy', '--scope', 'user', '--', 'node', '/x/dist/index.js']);
  });

  it('dry run changes nothing', () => {
    const { env, home, log, calls, opened } = fixture({ which: () => '/bin/claude' });
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "x"\n');
    expect(runSetup({ ...base, dryRun: true }, env)).toBe(0);
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toBe('model = "x"\n');
    expect(existsSync(join(home, 'booksy-mcp'))).toBe(false);
    expect(calls.every((args) => args[1] === 'get')).toBe(true);
    expect(opened).toEqual([]);
    expect(log.join('\n')).toContain('[dry run]');
  });

  it('does not overwrite a Claude Desktop file that is not valid JSON', () => {
    const { env } = fixture();
    const desktop = claudeDesktopConfigPath(env);
    mkdirSync(join(desktop, '..'), { recursive: true });
    writeFileSync(desktop, '{ broken');
    expect(runSetup({ ...base, client: 'claude-desktop' }, env)).toBe(1);
    expect(readFileSync(desktop, 'utf8')).toBe('{ broken');
  });

  it('reports when no client is found and when Node is too old', () => {
    const { env, log } = fixture();
    expect(runSetup(base, env)).toBe(1);
    expect(log.join('\n')).toContain('No MCP client was configured');
    const old = fixture({ nodeVersion: 'v18.0.0' });
    expect(runSetup(base, old.env)).toBe(1);
    expect(old.log[0]).toContain('Node.js 20');
  });

  it('uninstall removes only the booksy entries and the extension folder', () => {
    const { env, home } = fixture();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers.keep]\ncommand = "k"\n');
    expect(runSetup({ ...base, client: 'codex' }, env)).toBe(0);
    expect(runSetup({ ...base, client: 'codex', uninstall: true }, env)).toBe(0);
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toBe('[mcp_servers.keep]\ncommand = "k"\n');
    expect(existsSync(join(home, 'booksy-mcp', 'extension'))).toBe(false);
  });

  it('uninstall leaves a foreign folder alone', () => {
    const { env, home } = fixture();
    const dir = join(home, 'booksy-mcp', 'extension');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mine.txt'), 'x');
    runSetup({ ...base, uninstall: true }, env);
    expect(existsSync(join(dir, 'mine.txt'))).toBe(true);
  });
});
