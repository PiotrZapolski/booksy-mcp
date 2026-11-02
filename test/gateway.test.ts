import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAFE_TRAFFIC, type TrafficPolicy, UNRESTRICTED_TRAFFIC } from '../src/config.js';
import { Gateway } from '../src/gateway/gateway.js';
import { TrafficLedger } from '../src/gateway/ledger.js';
import { sanitize } from '../src/gateway/sanitize.js';
import { stableStringify } from '../src/gateway/cache.js';
import type { PanelResult } from '../src/shared/protocol.js';
import { FakeBridge, tempDir } from './helpers.js';

function setup(
  respond: () => PanelResult = () => ({ ok: true, data: { items: [1] } }),
  traffic: TrafficPolicy = UNRESTRICTED_TRAFFIC,
  ledgerPath?: string,
) {
  let time = 1_000_000;
  const bridge = new FakeBridge(respond);
  const waits: number[] = [];
  const gateway = new Gateway(bridge, {
    traffic,
    maskContacts: false,
    now: () => time,
    random: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
      time += ms;
    },
    ...(ledgerPath ? { ledgerPath } : {}),
  });
  return { bridge, gateway, waits, advance: (ms: number) => (time += ms) };
}

describe('Gateway', () => {
  it('serves a repeat read from the cache', async () => {
    const { bridge, gateway } = setup();
    await gateway.request('reviews.list');
    const second = await gateway.request('reviews.list');
    expect(second.fromCache).toBe(true);
    expect(bridge.sent()).toHaveLength(1);
  });

  it('asks again after the cache expires or with fresh', async () => {
    const { bridge, gateway, advance } = setup();
    await gateway.request('reviews.list');
    await gateway.request('reviews.list', { fresh: true });
    expect(bridge.sent()).toHaveLength(2);
    advance(61_000);
    await gateway.request('reviews.list');
    expect(bridge.sent()).toHaveLength(3);
  });

  it('keeps a separate cache entry per parameters', async () => {
    const { bridge, gateway } = setup();
    await gateway.request('customers.list', { params: { page: 1 } });
    await gateway.request('customers.list', { params: { page: 2 } });
    expect(bridge.sent()).toHaveLength(2);
  });

  it('sends a rule id, never a URL', async () => {
    const { bridge, gateway } = setup();
    await gateway.request('customers.read', { urlParams: { customerId: '7' } });
    expect(bridge.sent()[0]).toMatchObject({
      type: 'call',
      request: { ruleId: 'customers.read', urlParams: { customerId: '7' } },
    });
    expect(JSON.stringify(bridge.sent()[0])).not.toContain('business_api');
  });

  it('refuses a rule outside the list before any network step', async () => {
    const { bridge, gateway } = setup();
    await expect(gateway.request('account.delete')).rejects.toMatchObject({ code: 'rule_rejected' });
    expect(bridge.calls).toHaveLength(0);
  });

  it('a write clears the cache', async () => {
    const { bridge, gateway } = setup();
    await gateway.request('reviews.list');
    await gateway.request('reviews.reply', { urlParams: { reviewId: '1' }, data: {} });
    await gateway.request('reviews.list');
    expect(bridge.sent()).toHaveLength(3);
  });

  it('reports a logged-out panel plainly', async () => {
    const { gateway } = setup(() => ({ ok: false, status: 401 }));
    await expect(gateway.request('reviews.list')).rejects.toMatchObject({ code: 'not_logged_in' });
  });

  it('removes tokens from responses', async () => {
    const { gateway } = setup(() => ({
      ok: true,
      data: { nested: [{ access_token: 'secret-value', name: 'kept' }] },
    }));
    const response = await gateway.request('reviews.list');
    expect(JSON.stringify(response.data)).not.toContain('secret-value');
    expect(JSON.stringify(response.data)).toContain('kept');
  });

  it('decodes a downloaded file', async () => {
    const { gateway } = setup(() => ({
      ok: true,
      base64: Buffer.from('hello').toString('base64'),
      contentType: 'application/pdf',
      filename: 'a.pdf',
    }));
    const file = await gateway.download('invoices.pdf', { urlParams: { invoiceId: '1' } });
    expect(file.bytes.toString()).toBe('hello');
    expect(file.filename).toBe('a.pdf');
  });
});

describe.each([
  ['safe mode', SAFE_TRAFFIC],
  ['safe mode off', UNRESTRICTED_TRAFFIC],
])('stop signals with %s', (_name, traffic) => {
  it('a 429 stops all traffic at once, without a retry, for the whole cooldown', async () => {
    const { bridge, gateway, advance } = setup(() => ({ ok: false, status: 429 }), traffic);
    await expect(gateway.request('reviews.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    await expect(gateway.request('customers.list')).rejects.toThrow(/Paused/);
    advance(traffic.blockCooldownMs - 60_000);
    await expect(gateway.request('customers.list')).rejects.toThrow(/Paused/);
    expect(bridge.sent()).toHaveLength(1);
    advance(60_001);
    await expect(gateway.request('customers.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    expect(bridge.sent()).toHaveLength(2);
  });

  it('a captcha or block answer stops traffic', async () => {
    const { bridge, gateway } = setup(
      () => ({ ok: false, status: 400, data: { errors: [{ code: 'request_blocked' }] } }),
      traffic,
    );
    await expect(gateway.request('reviews.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    await expect(gateway.request('reviews.list')).rejects.toThrow(/Paused/);
    expect(bridge.sent()).toHaveLength(1);
  });

  it('a single 403 stops traffic for its own cooldown', async () => {
    const { bridge, gateway, advance } = setup(() => ({ ok: false, status: 403, data: {} }), traffic);
    await expect(gateway.request('reviews.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    expect(gateway.status().cooldown).toMatchObject({ active: true, reason: 'a 403 answer from Booksy' });
    await expect(gateway.request('reviews.list')).rejects.toThrow(/Paused/);
    expect(bridge.sent()).toHaveLength(1);
    advance(traffic.forbiddenCooldownMs + 1);
    expect(gateway.status().cooldown.active).toBe(false);
  });

  it('a chat answer of 429 stops traffic too', async () => {
    const { bridge, gateway } = setup(() => ({ ok: false, status: 429, failure: 'chat_failed' }), traffic);
    const read = { action: 'list', limit: 5, offset: 0 } as const;
    await expect(gateway.chat(read)).rejects.toMatchObject({ code: 'blocked_by_booksy' });
    await expect(gateway.chat(read)).rejects.toThrow(/Paused/);
    expect(bridge.sent()).toHaveLength(1);
  });

  it('requests waiting in line do not go out after a stop', async () => {
    const { bridge, gateway } = setup(() => ({ ok: false, status: 429 }), traffic);
    const results = await Promise.allSettled([
      gateway.request('reviews.list'),
      gateway.request('customers.list'),
      gateway.request('customers.groups'),
    ]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(bridge.sent()).toHaveLength(1);
  });

  it('a cooldown survives a restart', async () => {
    const path = join(tempDir(), 'state', 'traffic.json');
    const first = setup(() => ({ ok: false, status: 429 }), traffic, path);
    await expect(first.gateway.request('reviews.list')).rejects.toBeTruthy();
    const second = setup(() => ({ ok: true, data: {} }), traffic, path);
    await expect(second.gateway.request('reviews.list')).rejects.toThrow(/Paused/);
    expect(second.bridge.sent()).toHaveLength(0);
  });

  it('reset-cooldown reaches a running server', async () => {
    const path = join(tempDir(), 'traffic.json');
    const { bridge, gateway } = setup(() => ({ ok: false, status: 429 }), traffic, path);
    await expect(gateway.request('reviews.list')).rejects.toBeTruthy();
    new TrafficLedger(path).clearBlock();
    bridge.respond = () => ({ ok: true, data: {} });
    await expect(gateway.request('reviews.list')).resolves.toBeTruthy();
  });
});

describe('safe mode', () => {
  const safe = (overrides: Partial<TrafficPolicy> = {}): TrafficPolicy => ({
    ...SAFE_TRAFFIC,
    ...overrides,
  });

  it('keeps the minimum gap between requests', async () => {
    const { gateway, waits } = setup(undefined, safe());
    await gateway.request('reviews.list');
    await gateway.request('customers.list');
    expect(waits).toEqual([SAFE_TRAFFIC.minIntervalMs]);
  });

  it('spaces writes more than reads', async () => {
    const { gateway, waits } = setup(undefined, safe());
    await gateway.request('reviews.reply', { urlParams: { reviewId: '1' }, data: {} });
    await gateway.request('customers.delete', { urlParams: { customerId: '1' } });
    expect(waits).toEqual([SAFE_TRAFFIC.writeIntervalMs]);
  });

  it('keeps the gap between exports even with reads in between', async () => {
    const respond = () => ({ ok: true, base64: '' });
    const { gateway, waits, advance } = setup(respond, safe());
    const params = { params: { report_key: 'a' } };
    await gateway.download('stats.download', params);
    advance(SAFE_TRAFFIC.exportIntervalMs - 1000);
    await gateway.download('stats.download', params);
    expect(waits).toEqual([1000]);
  });

  it('stops at the hourly budget', async () => {
    const { bridge, gateway, advance } = setup(undefined, safe({ maxRequestsPerHour: 2 }));
    await gateway.request('reviews.list');
    await gateway.request('customers.list');
    await expect(gateway.request('customers.groups')).rejects.toMatchObject({
      code: 'budget_exhausted',
    });
    expect(bridge.sent()).toHaveLength(2);
    advance(3_600_001);
    await expect(gateway.request('customers.groups')).resolves.toBeTruthy();
  });

  it('stops at the daily budget, also after a restart', async () => {
    const path = join(tempDir(), 'traffic.json');
    const traffic = safe({ maxRequestsPerDay: 1 });
    await setup(undefined, traffic, path).gateway.request('reviews.list');
    const next = setup(undefined, traffic, path);
    await expect(next.gateway.request('customers.list')).rejects.toMatchObject({
      code: 'budget_exhausted',
    });
    expect(next.gateway.status().requests_last_24h).toEqual({ used: 1, limit: 1 });
  });

  it('stops at the daily export limit, and other reads go on', async () => {
    const respond = () => ({ ok: true, base64: '' });
    const { gateway } = setup(respond, safe({ maxExportsPerDay: 1 }));
    const params = { params: { report_key: 'a' } };
    await gateway.download('stats.download', params);
    await expect(gateway.download('stats.download', params)).rejects.toThrow(/report exports/);
    await expect(gateway.request('reviews.list')).resolves.toBeTruthy();
  });

  it('limits the requests of one tool call', async () => {
    const { bridge, gateway } = setup(undefined, safe({ maxPagesPerCall: 2 }));
    const work = gateway.scope(async () => {
      for (let page = 1; page <= 3; page += 1) {
        await gateway.request('customers.list', { params: { page } });
      }
    });
    await expect(work).rejects.toMatchObject({ code: 'safe_mode_limit' });
    expect(bridge.sent()).toHaveLength(2);
    await expect(
      gateway.scope(() => gateway.request('customers.list', { params: { page: 9 } })),
    ).resolves.toBeTruthy();
  });

  it('refuses a date range that is too long, before anything is sent', () => {
    const { gateway } = setup(undefined, safe());
    expect(() => gateway.assertRange('2026-01-01', '2026-04-02')).not.toThrow();
    expect(() => gateway.assertRange('2026-01-01', '2026-04-03')).toThrow(/at most 92 days/);
  });

  it('keeps answers longer and does not let fresh hammer the same read', async () => {
    const { bridge, gateway, advance } = setup(undefined, safe());
    await gateway.request('reviews.list');
    await gateway.request('reviews.list', { fresh: true });
    expect(bridge.sent()).toHaveLength(1);
    advance(61_000);
    await gateway.request('reviews.list', { fresh: true });
    expect(bridge.sent()).toHaveLength(2);
    advance(299_000);
    await gateway.request('reviews.list');
    expect(bridge.sent()).toHaveLength(2);
  });

  it('asks the extension to refuse an unattended panel', async () => {
    const { bridge, gateway } = setup(undefined, safe());
    await gateway.request('reviews.list');
    expect(bridge.sent()[0]).toMatchObject({
      request: { maxBackgroundMs: SAFE_TRAFFIC.maxBackgroundMs },
    });
  });

  it('explains a refused background tab', async () => {
    const { gateway } = setup(() => ({ ok: false, failure: 'panel_in_background' }), safe());
    await expect(gateway.request('reviews.list')).rejects.toMatchObject({
      code: 'panel_in_background',
    });
    expect(gateway.status().cooldown.active).toBe(false);
  });

  it('reports the mode, the use of budgets and no warning', async () => {
    const { gateway } = setup(undefined, safe());
    await gateway.request('reviews.list');
    const status = gateway.status();
    expect(status).toMatchObject({
      mode: 'safe',
      requests_this_hour: { used: 1, limit: 120 },
      exports_last_24h: { used: 0, limit: 15 },
      cooldown: { active: false },
    });
    expect(status.warning).toBeUndefined();
  });
});

describe('safe mode off', () => {
  it('has no gaps, no budgets and no refusals, but stays sequential', async () => {
    const { bridge, gateway, waits } = setup();
    let running = 0;
    let peak = 0;
    const respond = bridge.respond;
    bridge.respond = (call) => {
      running += 1;
      peak = Math.max(peak, running);
      running -= 1;
      return respond(call);
    };
    await Promise.all(
      Array.from({ length: 300 }, (_, page) =>
        gateway.request('customers.list', { params: { page } }),
      ),
    );
    expect(bridge.sent()).toHaveLength(300);
    expect(waits).toEqual([]);
    expect(peak).toBe(1);
    expect(() => gateway.assertRange('2020-01-01', '2026-01-01')).not.toThrow();
    expect(bridge.sent()[0]).not.toHaveProperty('request.maxBackgroundMs');
  });

  it('warns in the status', () => {
    const status = setup().gateway.status();
    expect(status.mode).toBe('unrestricted');
    expect(status.warning).toMatch(/Safe mode is OFF/);
    expect(status.requests_this_hour.limit).toBeNull();
  });
});

describe('sanitize', () => {
  it('masks contact data only on request', () => {
    const value = { cell_phone: '+48123456789', email: 'someone@example.com', name: 'A' };
    expect(sanitize(value, { maskContacts: false })).toEqual(value);
    const masked = sanitize(value, { maskContacts: true }) as typeof value;
    expect(masked.cell_phone).toBe('+4***89');
    expect(masked.email).not.toContain('example');
    expect(masked.name).toBe('A');
  });
});

describe('stableStringify', () => {
  it('ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: undefined, c: [{ y: 1, x: 2 }] })).toBe(
      stableStringify({ c: [{ x: 2, y: 1 }], b: 1 }),
    );
  });
});
