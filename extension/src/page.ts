/**
 * Functions that run inside the panel tab through chrome.scripting.executeScript. Chrome serialises
 * them, so each one must stand alone: no imports, no outer variables.
 *
 * They use the panel's own store action `api/call`. The panel's client adds its own headers, so this
 * code has no need to read the session token, and it does not. Only the status, the data and two
 * response headers are returned, never the request config that holds those headers.
 */
import type {
  ChatAction,
  FrameRequests,
  PanelContext,
  PanelRequest,
  PanelResult,
  QueryValue,
} from '../../src/shared/protocol.js';

export interface PageCall {
  method: string;
  path: string;
  request: PanelRequest;
}

interface PanelStore {
  state: {
    app?: { country?: string; language?: string };
    business?: {
      business?: {
        id?: number | string;
        name?: string;
        timezone?: string | number;
      };
    };
    identity?: { user?: { id?: number | string; access_level?: string } | null };
    routingConfig?: { config?: { hcaptcha?: Array<{ path: string; methods: string[] }> } };
  };
  dispatch(action: string, payload: unknown): Promise<AxiosLike>;
}

interface AxiosLike {
  status: number;
  data: unknown;
  headers?: Record<string, string | undefined>;
}

/** The panel context. Reads named fields only, never `identity.accessToken`. */
export function pageContext(): PanelResult {
  const root = document.querySelector('#app') as
    | (Element & { __vue_app__?: { config?: { globalProperties?: { $store?: PanelStore } } } })
    | null;
  const store = root?.__vue_app__?.config?.globalProperties?.$store;
  if (!store?.state?.app) return { ok: false, failure: 'panel_not_ready' };
  const business = store.state.business?.business;
  const user = store.state.identity?.user;
  if (!user) return { ok: false, failure: 'not_logged_in' };
  const context: PanelContext = {
    country: store.state.app.country ?? null,
    language: store.state.app.language ?? null,
    businessId: business?.id === undefined ? null : String(business.id),
    businessName: business?.name ?? null,
    timezone: business?.timezone === undefined ? null : String(business.timezone),
    userId: user.id === undefined ? null : String(user.id),
    accessLevel: user.access_level ?? null,
  };
  return { ok: true, context };
}

/**
 * Runs in the isolated world of the report frame. Reads the browser's own list of finished requests
 * and keeps the address shape only: ids become ":id", query values are dropped. Sends nothing.
 */
export function pageFrameRequests(): FrameRequests | null {
  if (location.hostname !== 'stats-and-reports.booksy.com') return null;
  const seen = new Map<string, FrameRequests['requests'][number]>();
  for (const item of performance.getEntriesByType('resource')) {
    const entry = item as PerformanceResourceTiming;
    if (entry.initiatorType !== 'xmlhttprequest' && entry.initiatorType !== 'fetch') continue;
    const url = new URL(entry.name);
    if (!url.hostname.endsWith('booksy.com')) continue;
    const path = url.pathname
      .split('/')
      .map((part) => (/^(\d{3,}|[0-9a-f-]{16,})$/i.test(part) ? ':id' : part))
      .join('/');
    const params = [...new Set(url.searchParams.keys())].sort();
    const key = `${url.hostname}${path}?${params.join(',')}`;
    const known = seen.get(key);
    const status = entry.responseStatus ? entry.responseStatus : null;
    if (known) {
      known.count += 1;
      known.status = status ?? known.status;
    } else {
      seen.set(key, { path: `${url.hostname}${path}`, params, count: 1, status });
    }
  }
  return { host: location.hostname, requests: [...seen.values()] };
}

export async function pageCall(call: PageCall): Promise<PanelResult> {
  const root = document.querySelector('#app') as
    | (Element & { __vue_app__?: { config?: { globalProperties?: { $store?: PanelStore } } } })
    | null;
  const store = root?.__vue_app__?.config?.globalProperties?.$store;
  if (!store?.state?.app) return { ok: false, failure: 'panel_not_ready' };
  if (!store.state.identity?.user) return { ok: false, failure: 'not_logged_in' };

  const business = store.state.business?.business;
  const user = store.state.identity.user;
  const context: PanelContext = {
    country: store.state.app.country ?? null,
    language: store.state.app.language ?? null,
    businessId: business?.id === undefined ? null : String(business.id),
    businessName: business?.name ?? null,
    timezone: business?.timezone === undefined ? null : String(business.timezone),
    userId: user.id === undefined ? null : String(user.id),
    accessLevel: user.access_level ?? null,
  };

  const protectedPaths = store.state.routingConfig?.config?.hcaptcha ?? [];
  const bare = call.path.replace(/\/?(\?.*)?$/, '');
  const guarded = protectedPaths.some(
    (entry) =>
      bare.endsWith(entry.path.replace(/\/$/, '')) &&
      Array.isArray(entry.methods) &&
      entry.methods.includes(call.method),
  );
  if (guarded) return { ok: false, failure: 'captcha_protected', context };

  const config: Record<string, unknown> = {
    method: call.method,
    url: call.path,
    urlParams: call.request.urlParams ?? {},
    timeout: call.request.timeoutMs,
  };
  if (call.request.params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries<QueryValue>(call.request.params)) {
      if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));
      else search.append(key, String(value));
    }
    config.params = search;
  }
  if (call.request.data !== undefined) config.data = call.request.data;
  if (call.request.binary) config.responseType = 'blob';

  const toBase64 = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks: string[] = [];
    const size = 0x8000;
    for (let i = 0; i < bytes.length; i += size) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + size)));
    }
    return btoa(chunks.join(''));
  };

  try {
    const response = await store.dispatch('api/call', config);
    const headers = response.headers ?? {};
    const result: PanelResult = { ok: true, status: response.status, context };
    const contentType = headers['content-type'];
    if (contentType) result.contentType = contentType;
    const disposition = headers['content-disposition'];
    if (disposition) {
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      if (match?.[1]) result.filename = decodeURIComponent(match[1]);
    }
    if (call.request.binary) result.base64 = await toBase64(response.data as Blob);
    else result.data = response.data;
    return result;
  } catch (error) {
    const response = (error as { response?: AxiosLike }).response;
    const raw = response?.data;
    let data: unknown = raw;
    if (typeof Blob !== 'undefined' && raw instanceof Blob) data = await raw.text();
    const failure: PanelResult = { ok: false, context, data };
    if (response?.status) failure.status = response.status;
    else failure.message = (error as Error).message;
    return failure;
  }
}

/**
 * Chat messages live with the chat provider the panel uses. Booksy issues a short-lived chat token
 * for this. The token is requested, used and dropped inside this function. It is not the session
 * token, and it is never part of the return value.
 */
export async function pageChat(chat: ChatAction, base: string): Promise<PanelResult> {
  const root = document.querySelector('#app') as
    | (Element & { __vue_app__?: { config?: { globalProperties?: { $store?: PanelStore } } } })
    | null;
  const store = root?.__vue_app__?.config?.globalProperties?.$store;
  if (!store?.state?.app) return { ok: false, failure: 'panel_not_ready' };
  if (!store.state.identity?.user) return { ok: false, failure: 'not_logged_in' };

  const prefix = '/business_api/me/businesses/:businessId/stream_chat';
  try {
    const config = (await store.dispatch('api/call', { method: 'GET', url: `${prefix}/config/` }))
      .data as { api_key?: string; stream_user_id?: string };
    const issued = (await store.dispatch('api/call', { method: 'POST', url: `${prefix}/token/` }))
      .data as { token?: string };
    if (!config.api_key || !config.stream_user_id || !issued.token) {
      return { ok: false, failure: 'chat_failed', message: 'Chat is not enabled for this account.' };
    }

    let path: string;
    let body: unknown;
    if (chat.action === 'list') {
      path = '/channels';
      body = {
        filter_conditions: { type: 'messaging', members: { $in: [config.stream_user_id] } },
        sort: [{ field: 'last_message_at', direction: -1 }],
        limit: chat.limit,
        offset: chat.offset,
        message_limit: 1,
        state: true,
        watch: false,
      };
    } else if (chat.action === 'read') {
      path = `/channels/messaging/${encodeURIComponent(chat.channelId)}/query`;
      body = { state: true, watch: false, messages: { limit: chat.limit } };
    } else {
      path = `/channels/messaging/${encodeURIComponent(chat.channelId)}/message`;
      body = { message: { text: chat.text } };
    }

    const url = `${base}${path}?api_key=${encodeURIComponent(config.api_key)}&user_id=${encodeURIComponent(config.stream_user_id)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: issued.token,
        'stream-auth-type': 'jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      return { ok: false, failure: 'chat_failed', status: response.status, data };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    const failure: PanelResult = {
      ok: false,
      failure: 'chat_failed',
      message: 'Chat could not be reached. It may not be enabled for this account.',
    };
    if (status) failure.status = status;
    return failure;
  }
}
