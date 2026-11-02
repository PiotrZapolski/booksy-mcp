import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, SAFE_TRAFFIC, UNRESTRICTED_TRAFFIC } from '../src/config.js';
import { tempDir } from './helpers.js';

function load(env: Record<string, string> = {}, file?: object) {
  const dir = tempDir();
  if (file) writeFileSync(join(dir, 'config.json'), JSON.stringify(file));
  return loadConfig({ BOOKSY_MCP_CONFIG_DIR: dir, ...env }).traffic;
}

describe('redactPii', () => {
  it('is off by default and has an environment switch and a former name', () => {
    const dir = tempDir();
    const base = { BOOKSY_MCP_CONFIG_DIR: dir };
    expect(loadConfig(base).redactPii).toBe(false);
    expect(loadConfig({ ...base, BOOKSY_MCP_REDACT_PII: '1' }).redactPii).toBe(true);
    expect(loadConfig({ ...base, BOOKSY_MCP_MASK_CONTACTS: '1' }).redactPii).toBe(true);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ redactPii: true }));
    expect(loadConfig(base).redactPii).toBe(true);
  });
});

describe('safe mode switch', () => {
  it('is on by default', () => {
    expect(load()).toEqual(SAFE_TRAFFIC);
  });

  it.each(['0', 'false', 'FALSE', 'off', 'no'])('goes off only with an explicit %s', (value) => {
    expect(load({ BOOKSY_MCP_SAFE_MODE: value }).safeMode).toBe(false);
  });

  it.each(['', ' ', '1', 'true', 'of', 'disabled', 'nope'])('stays on with "%s"', (value) => {
    expect(load({ BOOKSY_MCP_SAFE_MODE: value }).safeMode).toBe(true);
  });

  it('goes off in the file only with false', () => {
    expect(load({}, { safeMode: false }).safeMode).toBe(false);
    expect(load({}, { safeMode: 'no' }).safeMode).toBe(true);
  });

  it('the environment wins over the file', () => {
    expect(load({ BOOKSY_MCP_SAFE_MODE: '1' }, { safeMode: false }).safeMode).toBe(true);
  });

  it('own settings can tighten safe mode but not loosen it', () => {
    const tighter = load({
      BOOKSY_MCP_MIN_INTERVAL_MS: '9000',
      BOOKSY_MCP_MAX_REQUESTS_PER_HOUR: '50',
    });
    expect(tighter).toMatchObject({ minIntervalMs: 9000, maxRequestsPerHour: 50 });
    const looser = load({
      BOOKSY_MCP_MIN_INTERVAL_MS: '100',
      BOOKSY_MCP_MAX_REQUESTS_PER_HOUR: '9999',
    });
    expect(looser).toMatchObject({
      minIntervalMs: SAFE_TRAFFIC.minIntervalMs,
      maxRequestsPerHour: SAFE_TRAFFIC.maxRequestsPerHour,
    });
  });

  it('own settings apply as set with safe mode off', () => {
    expect(load({ BOOKSY_MCP_SAFE_MODE: '0' })).toEqual(UNRESTRICTED_TRAFFIC);
    const own = load({ BOOKSY_MCP_SAFE_MODE: '0', BOOKSY_MCP_MAX_REQUESTS_PER_HOUR: '700' });
    expect(own.maxRequestsPerHour).toBe(700);
  });

  it('the README documents every safe mode threshold', () => {
    const section = readme().split('## Safe mode')[1]?.split('\n## ')[0] ?? '';
    for (const key of Object.keys(SAFE_TRAFFIC).filter((name) => name !== 'safeMode')) {
      expect(section, key).toContain(`\`${key}\``);
    }
  });
});

function readme(): string {
  return readFileSync('README.md', 'utf8');
}
