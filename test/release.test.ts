import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src/server.js';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('release metadata', () => {
  const pkg = read('package.json');
  const registry = read('server.json');
  const bundle = read('mcpb/manifest.json');

  it('carries one version everywhere', () => {
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(registry.version).toBe(pkg.version);
    expect(bundle.version).toBe(pkg.version);
  });

  it('publishes to the registry under the name from package.json', () => {
    expect(registry.name).toBe(pkg.mcpName);
  });

  it('lists the MCP Bundle from the GitHub release of this version', () => {
    expect(registry.packages).toHaveLength(2);
    const entry = registry.packages.find((item: { registryType: string }) => item.registryType === 'mcpb');
    expect(entry.version).toBe(pkg.version);
    expect(entry.identifier).toBe(
      `${registry.repository.url}/releases/download/v${pkg.version}/booksy-mcp-${pkg.version}.mcpb`,
    );
    expect(entry.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.transport).toEqual({ type: 'stdio' });
  });

  it('lists the npm package of this version, under the name npx installs', () => {
    const entry = registry.packages.find((item: { registryType: string }) => item.registryType === 'npm');
    expect(entry.identifier).toBe(pkg.name);
    expect(entry.identifier).toBe('booksy-biz-mcp');
    expect(entry.version).toBe(pkg.version);
    expect(entry.transport).toEqual({ type: 'stdio' });
    expect(entry.fileSha256).toBeUndefined();
    const bundleEntry = registry.packages.find(
      (item: { registryType: string }) => item.registryType === 'mcpb',
    );
    expect(entry.environmentVariables).toEqual(bundleEntry.environmentVariables);
  });

  it('writes the release version into both entries of the published server.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'booksy-release-'));
    try {
      const bundlePath = join(dir, `booksy-mcp-${pkg.version}.mcpb`);
      const output = join(dir, 'server.json');
      writeFileSync(bundlePath, 'bundle bytes');
      execFileSync(process.execPath, ['scripts/release-server-json.mjs', bundlePath, output]);
      const published = read(output);
      const sha256 = createHash('sha256').update('bundle bytes').digest('hex');
      expect(published.version).toBe(pkg.version);
      expect(published.packages.map((item: { registryType: string }) => item.registryType)).toEqual([
        'mcpb',
        'npm',
      ]);
      for (const item of published.packages) expect(item.version).toBe(pkg.version);
      expect(published.packages[0].fileSha256).toBe(sha256);
      expect(published.packages[1].identifier).toBe('booksy-biz-mcp');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts the bundle from the built entry point', () => {
    expect(bundle.server.entry_point).toBe('dist/index.js');
    expect(bundle.server.mcp_config.args).toEqual(['${__dirname}/dist/index.js']);
  });
});
