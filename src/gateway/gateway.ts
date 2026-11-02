import type { Bridge } from '../bridge/server.js';
import { BooksyError } from '../errors.js';
import { resolveRule, type Rule } from '../shared/allowlist.js';
import type {
  ChatAction,
  PanelContext,
  PanelFailure,
  PanelRequest,
  PanelResult,
  QueryValue,
} from '../shared/protocol.js';
import { Breaker } from './breaker.js';
import { stableStringify, TtlCache } from './cache.js';
import { SequentialLimiter } from './limiter.js';
import { sanitize } from './sanitize.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_SECONDS = 60;
const CONTEXT_TTL_MS = 30_000;
const CHAT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  urlParams?: Record<string, string>;
  params?: Record<string, QueryValue | undefined>;
  data?: unknown;
  fresh?: boolean;
}

export interface GatewayResponse {
  data: unknown;
  fromCache: boolean;
  businessId: string | null;
}

export interface BinaryResponse {
  bytes: Buffer;
  contentType: string | null;
  filename: string | null;
  businessId: string | null;
}

export interface GatewayOptions {
  minIntervalMs: number;
  maxRequestsPerHour: number;
  maskContacts: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const FAILURE_MESSAGES: Partial<Record<PanelFailure, BooksyError>> = {
  tab_missing: new BooksyError(
    'panel_tab_missing',
    'No Booksy Biz tab is open. Open https://booksy.com/pro in Chrome and log in.',
  ),
  tab_discarded: new BooksyError(
    'panel_tab_discarded',
    'Chrome has put the Booksy Biz tab to sleep. Click the tab once to wake it.',
  ),
  panel_not_ready: new BooksyError(
    'panel_not_ready',
    'The Booksy Biz tab is still loading, or the panel has changed and this version cannot use it.',
  ),
  not_logged_in: new BooksyError('not_logged_in', 'Log in to Booksy Biz in the open tab.'),
  captcha_protected: new BooksyError(
    'captcha_protected',
    'Booksy protects this action with a captcha. Do it yourself in the panel. This tool never ' +
      'tries to get past a captcha.',
  ),
  writes_disabled_in_extension: new BooksyError(
    'writes_disabled_in_extension',
    'Writes are switched off in the browser extension. Turn on "Allow writes" in its popup.',
  ),
};

/** The single path from a tool to the browser: policy, cache, breaker, queue, then the bridge. */
export class Gateway {
  private readonly limiter: SequentialLimiter;
  private readonly breaker: Breaker;
  private readonly cache: TtlCache<unknown>;
  private readonly now: () => number;
  private knownContext: PanelContext | null = null;
  private contextAt = 0;

  constructor(
    private readonly bridge: Bridge,
    private readonly options: GatewayOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.limiter = new SequentialLimiter({
      minIntervalMs: options.minIntervalMs,
      maxPerHour: options.maxRequestsPerHour,
      now: this.now,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
    this.breaker = new Breaker(this.now);
    this.cache = new TtlCache(this.now);
  }

  async context(fresh = false): Promise<PanelContext> {
    if (!fresh && this.knownContext && this.now() - this.contextAt < CONTEXT_TTL_MS) {
      return this.knownContext;
    }
    const result = await this.bridge.call({ type: 'context' }, DEFAULT_TIMEOUT_MS);
    if (!result.ok) throw this.toError(result);
    this.remember(result.context);
    if (!this.knownContext) throw FAILURE_MESSAGES.panel_not_ready as BooksyError;
    return this.knownContext;
  }

  async request(ruleId: string, options: RequestOptions = {}): Promise<GatewayResponse> {
    const rule = this.check(ruleId, options);
    if (rule.binary) throw new Error(`Rule ${ruleId} returns a file, use download()`);

    const cacheable = rule.kind === 'read';
    const key = cacheable ? await this.cacheKey(rule, options) : '';
    if (cacheable && !options.fresh) {
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        return { data: cached, fromCache: true, businessId: this.businessId() };
      }
    }

    const result = await this.send(rule, options);
    const data = sanitize(result.data, { maskContacts: this.options.maskContacts });
    if (cacheable) this.cache.set(key, data, rule.cacheSeconds ?? DEFAULT_CACHE_SECONDS);
    else if (rule.kind === 'write') this.cache.clear();
    return { data, fromCache: false, businessId: this.businessId() };
  }

  async download(ruleId: string, options: RequestOptions = {}): Promise<BinaryResponse> {
    const rule = this.check(ruleId, options);
    if (!rule.binary) throw new Error(`Rule ${ruleId} does not return a file`);
    const result = await this.send(rule, options);
    return {
      bytes: Buffer.from(result.base64 ?? '', 'base64'),
      contentType: result.contentType ?? null,
      filename: result.filename ?? null,
      businessId: this.businessId(),
    };
  }

  async chat(chat: ChatAction): Promise<unknown> {
    this.breaker.assertClosed();
    const result = await this.limiter.schedule(() =>
      this.bridge.call(
        { type: 'chat', request: { chat, timeoutMs: CHAT_TIMEOUT_MS } },
        CHAT_TIMEOUT_MS,
      ),
    );
    this.remember(result.context);
    if (!result.ok) throw this.toError(result);
    this.breaker.success();
    return sanitize(result.data, { maskContacts: this.options.maskContacts });
  }

  invalidate(): void {
    this.cache.clear();
  }

  status(): {
    requestsThisHour: number;
    budgetPerHour: number;
    breaker: ReturnType<Breaker['status']>;
  } {
    return {
      requestsThisHour: this.limiter.usedThisHour(),
      budgetPerHour: this.options.maxRequestsPerHour,
      breaker: this.breaker.status(),
    };
  }

  private check(ruleId: string, options: RequestOptions): Rule {
    try {
      return resolveRule(ruleId, options.urlParams);
    } catch (error) {
      throw new BooksyError('rule_rejected', (error as Error).message);
    }
  }

  private async send(rule: Rule, options: RequestOptions): Promise<PanelResult> {
    this.breaker.assertClosed();
    const request = buildRequest(rule, options);
    const timeoutMs = rule.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = await this.limiter.schedule(() => {
      // Checked again here: the breaker may have tripped while this task waited in the queue.
      this.breaker.assertClosed();
      return this.bridge.call({ type: 'call', request }, timeoutMs);
    });
    this.remember(result.context);
    if (!result.ok) throw this.toError(result);
    this.breaker.success();
    return result;
  }

  private toError(result: PanelResult): BooksyError {
    const known = result.failure ? FAILURE_MESSAGES[result.failure] : undefined;
    if (known) return known;

    const status = result.status ?? 0;
    const body = sanitize(result.data, { maskContacts: this.options.maskContacts });
    const text = JSON.stringify(result.data ?? '').toLowerCase();

    if (status === 401) return FAILURE_MESSAGES.not_logged_in as BooksyError;
    if (status === 429 || /request_blocked|captcha/.test(text)) {
      this.breaker.trip(status === 429 ? 'a 429 answer from Booksy' : 'a block answer from Booksy');
      return new BooksyError(
        'blocked_by_booksy',
        'Booksy refused the request as automated or too frequent. All requests are paused for 15 ' +
          'minutes. Check the panel in your browser.',
      );
    }
    if (status === 403) this.breaker.forbidden();
    if (result.failure === 'chat_failed') {
      return new BooksyError('chat_failed', result.message ?? 'Chat request failed.', body);
    }
    if (result.failure === 'rule_rejected') {
      return new BooksyError('rule_rejected', result.message ?? 'The extension refused the call.');
    }
    if (status >= 400) {
      return new BooksyError('booksy_error', `Booksy answered with status ${status}.`, body);
    }
    return new BooksyError('request_failed', result.message ?? 'The request did not complete.');
  }

  private remember(context: PanelContext | undefined): void {
    if (!context) return;
    this.knownContext = context;
    this.contextAt = this.now();
  }

  private businessId(): string | null {
    return this.knownContext?.businessId ?? null;
  }

  private async cacheKey(rule: Rule, options: RequestOptions): Promise<string> {
    const context = await this.context();
    return stableStringify([context.businessId, rule.id, options.urlParams, options.params]);
  }
}

function buildRequest(rule: Rule, options: RequestOptions): PanelRequest {
  const request: PanelRequest = { ruleId: rule.id };
  if (options.urlParams) request.urlParams = options.urlParams;
  if (options.params) {
    const params: Record<string, QueryValue> = {};
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) params[key] = value;
    }
    request.params = params;
  }
  if (options.data !== undefined) request.data = options.data;
  if (rule.binary) request.binary = true;
  request.timeoutMs = rule.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return request;
}
