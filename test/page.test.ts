import { describe, expect, it, vi } from 'vitest';
import { unattended } from '../extension/src/guard.js';
import { pageCall, pageChat, pageContext, pageFrameRequests } from '../extension/src/page.js';
import { hmacHex } from '../extension/src/crypto.js';
import { proof } from '../src/bridge/pairing.js';

const TOKEN = 'SESSION-TOKEN-VALUE';

function installPanel(dispatch: (action: string, payload: never) => Promise<unknown>, state = {}) {
  const store = {
    state: {
      app: { country: 'pl', language: 'pl' },
      business: { business: { id: 1001, name: 'Sample Barbers', timezone: 'Europe/Warsaw' } },
      identity: { accessToken: TOKEN, user: { id: 2002, access_level: 'owner' } },
      routingConfig: { config: {} },
      ...state,
    },
    dispatch,
  };
  vi.stubGlobal('document', {
    querySelector: () => ({ __vue_app__: { config: { globalProperties: { $store: store } } } }),
  });
  return store;
}

const call = (extra = {}) => ({
  method: 'GET',
  path: '/business_api/me/businesses/:businessId/reviews/',
  request: { ruleId: 'reviews.list', timeoutMs: 30000, ...extra },
});

describe('pageCall', () => {
  it('uses the panel action and passes the rule path', async () => {
    const dispatch = vi.fn(async () => ({ status: 200, data: { reviews: [] }, headers: {} }));
    installPanel(dispatch);
    const result = await pageCall(call({ params: { page: 1 } }));
    expect(result.ok).toBe(true);
    const [action, config] = dispatch.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(action).toBe('api/call');
    expect(config.url).toContain('/reviews/');
    expect(String(config.params)).toBe('page=1');
  });

  it('never returns the request config or the session token', async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      data: { ok: 1 },
      headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' },
      config: { headers: { 'X-Access-Token': TOKEN } },
      request: { token: TOKEN },
    }));
    installPanel(dispatch);
    const result = await pageCall(call());
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result).not.toHaveProperty('config');
    expect(JSON.stringify(result)).not.toContain('set-cookie');
  });

  it('does not leak the token from a failed request', async () => {
    const dispatch = vi.fn(async () => {
      throw Object.assign(new Error('boom'), {
        config: { headers: { 'X-Access-Token': TOKEN } },
        response: {
          status: 403,
          data: { errors: [] },
          config: { headers: { 'X-Access-Token': TOKEN } },
        },
      });
    });
    installPanel(dispatch);
    const result = await pageCall(call());
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('context has no token', () => {
    installPanel(vi.fn());
    const result = pageContext();
    expect(result.context).toMatchObject({ businessId: '1001', country: 'pl', userId: '2002' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('refuses a path the panel protects with a captcha, without calling it', async () => {
    const dispatch = vi.fn();
    installPanel(dispatch, {
      routingConfig: {
        config: { hcaptcha: [{ path: '/reviews', methods: ['GET'] }] },
      },
    });
    const result = await pageCall(call());
    expect(result.failure).toBe('captcha_protected');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reports a missing store and a logged-out panel', async () => {
    vi.stubGlobal('document', { querySelector: () => null });
    expect((await pageCall(call())).failure).toBe('panel_not_ready');
    installPanel(vi.fn(), { identity: { user: null } });
    expect((await pageCall(call())).failure).toBe('not_logged_in');
  });

  it('encodes a file and reads its name', async () => {
    const dispatch = vi.fn(async () => ({
      status: 200,
      data: new Blob([new Uint8Array([1, 2, 3])]),
      headers: {
        'content-type': 'application/vnd.ms-excel',
        'content-disposition': 'attachment; filename="report.xlsx"',
      },
    }));
    installPanel(dispatch);
    const result = await pageCall(call({ binary: true }));
    expect(result.base64).toBe('AQID');
    expect(result.filename).toBe('report.xlsx');
    expect(result.data).toBeUndefined();
  });

  it('survives Chrome serialising the function', () => {
    for (const fn of [pageCall, pageContext, pageChat, pageFrameRequests]) {
      const source = fn.toString();
      expect(source).not.toMatch(/__vite|require\(|import\(/);
      expect(() => new Function(`return (${source})`)).not.toThrow();
    }
  });
});

describe('pageFrameRequests', () => {
  const entries = [
    {
      name: 'https://pl.booksy.com/api/pl/2/business_api/me/stats/businesses/1001000/dashboard?date_from=2026-11-01&dashboard=staff',
      initiatorType: 'xmlhttprequest',
      responseStatus: 200,
    },
    {
      name: 'https://pl.booksy.com/api/pl/2/business_api/me/stats/businesses/1001000/dashboard?date_from=2026-10-01&dashboard=tips',
      initiatorType: 'xmlhttprequest',
      responseStatus: 0,
    },
    { name: 'https://stats-and-reports.booksy.com/assets/a.js', initiatorType: 'script' },
    { name: 'https://example.com/track', initiatorType: 'fetch' },
  ];

  it('keeps address shapes, without ids or values', () => {
    vi.stubGlobal('location', { hostname: 'stats-and-reports.booksy.com' });
    vi.stubGlobal('performance', { getEntriesByType: () => entries });
    const result = pageFrameRequests();
    expect(result?.requests).toEqual([
      {
        path: 'pl.booksy.com/api/pl/2/business_api/me/stats/businesses/:id/dashboard',
        params: ['dashboard', 'date_from'],
        count: 2,
        status: 200,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/1001000|2026|tips/);
  });

  it('answers only in the report frame', () => {
    vi.stubGlobal('location', { hostname: 'booksy.com' });
    expect(pageFrameRequests()).toBeNull();
  });
});

describe('unattended', () => {
  const now = 10_000_000;
  const use = { active: true, minimized: false, lastAccessed: 0, computer: 'active', now };

  it('lets a visible tab work, however old the last click', () => {
    expect(unattended(use, 1000)).toBe(false);
  });

  it('stops a background tab only after the limit', () => {
    const hidden = { ...use, active: false };
    expect(unattended({ ...hidden, lastAccessed: now - 999 }, 1000)).toBe(false);
    expect(unattended({ ...hidden, lastAccessed: now - 1001 }, 1000)).toBe(true);
  });

  it('counts a minimized window as background', () => {
    expect(unattended({ ...use, minimized: true, lastAccessed: now - 1001 }, 1000)).toBe(true);
  });

  it('stops an idle or locked computer', () => {
    expect(unattended({ ...use, computer: 'idle' }, 1000)).toBe(true);
    expect(unattended({ ...use, computer: 'locked' }, 1000)).toBe(true);
  });
});

describe('pageChat', () => {
  it('keeps the chat token inside the function', async () => {
    const chatToken = 'CHAT-TOKEN-VALUE';
    const dispatch = vi.fn(async (_action: string, payload: { url: string }) =>
      payload.url.endsWith('/config/')
        ? { status: 200, data: { api_key: 'key', stream_user_id: 'user' } }
        : { status: 200, data: { token: chatToken } },
    );
    installPanel(dispatch as never);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ channels: [] })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await pageChat({ action: 'list', limit: 5, offset: 0 }, 'https://chat.test');
    expect(result).toMatchObject({ ok: true, data: { channels: [] } });
    expect(JSON.stringify(result)).not.toContain(chatToken);
    expect(fetchMock.mock.calls[0]?.[0 as never]).toContain('https://chat.test/channels');
  });

  it('says so when chat is off for the account', async () => {
    installPanel(vi.fn(async () => {
      throw Object.assign(new Error('x'), { response: { status: 404 } });
    }) as never);
    const result = await pageChat({ action: 'list', limit: 5, offset: 0 }, 'https://chat.test');
    expect(result).toMatchObject({ ok: false, failure: 'chat_failed', status: 404 });
  });
});

describe('crypto', () => {
  it('the extension and the server compute the same proof', async () => {
    const secret = 'ab'.repeat(32);
    expect(await hmacHex(secret, 'label', 'one', 'two')).toBe(proof(secret, 'label', 'one', 'two'));
  });
});
