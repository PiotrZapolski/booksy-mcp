import { describe, expect, it } from 'vitest';
import { getRule, resolveRule, RULES, RuleError } from '../src/shared/allowlist.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('allowlist', () => {
  it('rejects a rule that is not listed', () => {
    expect(() => resolveRule('account.login')).toThrow(RuleError);
  });

  it('rejects path traversal and separators in parameter values', () => {
    for (const value of ['../me', 'a/b', 'a?b=1', 'a#b', '', 'a b', '%2e%2e']) {
      expect(() => resolveRule('customers.read', { customerId: value })).toThrow(RuleError);
    }
  });

  it('rejects missing and unexpected parameters', () => {
    expect(() => resolveRule('customers.read')).toThrow(RuleError);
    expect(() => resolveRule('customers.read', { customerId: '1', other: '2' })).toThrow(RuleError);
  });

  it('never lets the caller choose the business, the panel fills it', () => {
    expect(() => resolveRule('customers.read', { customerId: '1', businessId: '9' })).toThrow(
      RuleError,
    );
  });

  it('marks every non-GET rule as estimate or write', () => {
    for (const rule of RULES) {
      if (rule.method !== 'GET') expect(rule.kind).not.toBe('read');
      if (rule.method === 'GET') expect(rule.kind).toBe('read');
    }
  });

  it('holds no login, billing or money-moving endpoint', () => {
    const forbidden = /\/login|password|billing\/(?!cycles)|\/refund\/|stripe|auth_token|subscriptions|stream_chat\/token/;
    for (const rule of RULES) expect(rule.path).not.toMatch(forbidden);
    const moneyMoves = /payout|refund|charge|pos\/transactions|payments/;
    for (const rule of RULES.filter((candidate) => candidate.method !== 'GET')) {
      expect(rule.path).not.toMatch(moneyMoves);
    }
  });

  it('has unique ids and no unused rules', () => {
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
    const source = ['src/tools']
      .flatMap((dir) => readdirSync(dir).map((file) => readFileSync(join(dir, file), 'utf8')))
      .join('\n');
    const unused = RULES.filter((rule) => !source.includes(`'${rule.id}'`)).map((rule) => rule.id);
    expect(unused).toEqual([]);
  });

  it('every tool name is unique and fits common client limits', () => {
    expect(new Set(ALL_TOOLS.map((tool) => tool.name)).size).toBe(ALL_TOOLS.length);
    for (const tool of ALL_TOOLS) expect(tool.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });

  it('getRule finds a rule', () => {
    expect(getRule('reviews.list')?.method).toBe('GET');
  });
});

describe('documentation', () => {
  const readme = readFileSync('README.md', 'utf8');

  it('the README lists every tool', () => {
    const missing = ALL_TOOLS.filter((tool) => !readme.includes(`\`${tool.name}\``));
    expect(missing.map((tool) => tool.name)).toEqual([]);
  });

  it('versions match across package files', () => {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const listing = JSON.parse(readFileSync('server.json', 'utf8'));
    const manifest = JSON.parse(readFileSync('extension/public/manifest.json', 'utf8'));
    expect(listing.version).toBe(version);
    expect(listing.packages[0].version).toBe(version);
    expect(manifest.version).toBe(version);
    expect(readFileSync('src/server.ts', 'utf8')).toContain(`SERVER_VERSION = '${version}'`);
  });
});
