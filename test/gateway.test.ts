import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway/gateway.js';
import { sanitize } from '../src/gateway/sanitize.js';
import { stableStringify } from '../src/gateway/cache.js';
import type { PanelResult } from '../src/shared/protocol.js';
import { FakeBridge } from './helpers.js';

function setup(respond: () => PanelResult = () => ({ ok: true, data: { items: [1] } })) {
  let time = 1_000_000;
  const bridge = new FakeBridge(respond);
  const gateway = new Gateway(bridge, {
    minIntervalMs: 1000,
    maxRequestsPerHour: 1000,
    maskContacts: false,
    now: () => time,
    sleep: async () => undefined,
  });
  return { bridge, gateway, advance: (ms: number) => (time += ms) };
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

  it('stops all traffic after a 429 and does not retry', async () => {
    const { bridge, gateway, advance } = setup(() => ({ ok: false, status: 429 }));
    await expect(gateway.request('reviews.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    await expect(gateway.request('customers.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    expect(bridge.sent()).toHaveLength(1);
    advance(15 * 60_000 + 1);
    await expect(gateway.request('customers.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    expect(bridge.sent()).toHaveLength(2);
  });

  it('treats a captcha or block answer as a stop signal', async () => {
    const { bridge, gateway } = setup(() => ({
      ok: false,
      status: 403,
      data: { errors: [{ code: 'request_blocked' }] },
    }));
    await expect(gateway.request('reviews.list')).rejects.toMatchObject({
      code: 'blocked_by_booksy',
    });
    await expect(gateway.request('reviews.list')).rejects.toThrow(/Paused/);
    expect(bridge.sent()).toHaveLength(1);
  });

  it('allows single 403 answers but stops after three in a row', async () => {
    const { bridge, gateway } = setup(() => ({ ok: false, status: 403, data: {} }));
    for (let i = 0; i < 3; i += 1) {
      await expect(gateway.request('reviews.list')).rejects.toMatchObject({ code: 'booksy_error' });
    }
    await expect(gateway.request('reviews.list')).rejects.toThrow(/Paused/);
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
