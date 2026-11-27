import { readFileSync } from 'node:fs';
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
    const [entry] = registry.packages;
    expect(registry.packages).toHaveLength(1);
    expect(entry.registryType).toBe('mcpb');
    expect(entry.version).toBe(pkg.version);
    expect(entry.identifier).toBe(
      `${registry.repository.url}/releases/download/v${pkg.version}/booksy-mcp-${pkg.version}.mcpb`,
    );
    expect(entry.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.transport).toEqual({ type: 'stdio' });
  });

  it('starts the bundle from the built entry point', () => {
    expect(bundle.server.entry_point).toBe('dist/index.js');
    expect(bundle.server.mcp_config.args).toEqual(['${__dirname}/dist/index.js']);
  });
});
