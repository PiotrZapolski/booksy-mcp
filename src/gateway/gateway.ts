import { AsyncLocalStorage } from 'node:async_hooks';
import type { Bridge } from '../bridge/server.js';
import { SAFE_MODE_OFF_WARNING, type TrafficPolicy } from '../config.js';
import { BooksyError } from '../errors.js';
import { resolveRule, type Rule } from '../shared/allowlist.js';
import type {
  ChatAction,
  ChatRequest,
  FrameRequests,
  PanelContext,
  PanelFailure,
  PanelRequest,
  PanelResult,
  QueryValue,
} from '../shared/protocol.js';
import { Breaker, describe, type BreakerStatus } from './breaker.js';
import { stableStringify, TtlCache } from './cache.js';
import { TrafficLedger } from './ledger.js';
import { DAY_MS, HOUR_MS, SequentialLimiter, type TaskKind } from './limiter.js';
import { sanitize } from './sanitize.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_SECONDS = 60;
const CONTEXT_TTL_MS = 30_000;
const CHAT_TIMEOUT_MS = 30_000;
/** A chat read or send asks Booksy for the chat config and a token before it talks to the chat. */
const CHAT_WEIGHT = 3;

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
  traffic: TrafficPolicy;
  maskContacts: boolean;
  /** File for budgets and cooldowns. Without it they last as long as this process. */
  ledgerPath?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface Usage {
  used: number;
  limit: number | null;
}

export interface TrafficStatus {
  mode: 'safe' | 'unrestricted';
  warning?: string;
  requests_this_hour: Usage;
  requests_last_24h: Usage;
  exports_last_24h: Usage;
  cooldown: BreakerStatus;
  limits: Record<string, number | null>;
}

function limit(value: number): number | null {
  return Number.isFinite(value) ? value : null;
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
  panel_in_background: new BooksyError(
    'panel_in_background',
    'The Booksy Biz tab has been in the background, or this computer unused, for too long. Safe ' +
      'mode sends no requests then. Click the tab once and try again.',
  ),
};

/** The single path from a tool to the browser: policy, cache, breaker, queue, then the bridge. */
export class Gateway {
  readonly traffic: TrafficPolicy;
  private readonly ledger: TrafficLedger;
  private readonly limiter: SequentialLimiter;
  private readonly breaker: Breaker;
  private readonly calls = new AsyncLocalStorage<{ pages: number }>();
  private readonly cache: TtlCache<unknown>;
  private readonly now: () => number;
  private knownContext: PanelContext | null = null;
  private contextAt = 0;

  constructor(
    private readonly bridge: Bridge,
    private readonly options: GatewayOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.traffic = options.traffic;
    this.ledger = new TrafficLedger(options.ledgerPath ?? null, this.now);
    this.breaker = new Breaker(this.ledger, this.now);
    this.limiter = new SequentialLimiter({
      policy: options.traffic,
      ledger: this.ledger,
      gate: () => this.breaker.assertClosed(),
      now: this.now,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.random ? { random: options.random } : {}),
    });
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
    if (cacheable && this.mayUseCache(key, options.fresh === true)) {
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        return { data: cached, fromCache: true, businessId: this.businessId() };
      }
    }

    const result = await this.send(rule, options);
    const data = sanitize(result.data, { maskContacts: this.options.maskContacts });
    if (cacheable) {
      const seconds = (rule.cacheSeconds ?? DEFAULT_CACHE_SECONDS) * this.traffic.cacheMultiplier;
      this.cache.set(key, data, seconds);
    }
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
    this.countPage();
    const request: ChatRequest = { chat, timeoutMs: CHAT_TIMEOUT_MS, ...this.guard() };
    const result = await this.limiter.schedule(
      () => this.bridge.call({ type: 'chat', request }, CHAT_TIMEOUT_MS),
      { kind: chat.action === 'send' ? 'write' : 'read', weight: CHAT_WEIGHT },
    );
    this.remember(result.context);
    if (!result.ok) throw this.toError(result);
    return sanitize(result.data, { maskContacts: this.options.maskContacts });
  }

  /** Addresses the report frame has asked for by itself. Sends nothing to Booksy. */
  async frameRequests(): Promise<FrameRequests[]> {
    const result = await this.bridge.call({ type: 'frames' }, DEFAULT_TIMEOUT_MS);
    if (!result.ok) throw this.toError(result);
    return (result.data as FrameRequests[] | undefined) ?? [];
  }

  /** Runs one tool call, so the page limit can count everything that call asks for. */
  scope<T>(work: () => Promise<T>): Promise<T> {
    return this.calls.run({ pages: 0 }, work);
  }

  /** Between two windows or weeks of one tool call. */
  pause(): Promise<void> {
    return this.limiter.pause(this.traffic.windowPauseMs);
  }

  /** Refuses a date range that is too long, before anything is sent. */
  assertRange(from: string, to: string, maxDays = this.traffic.maxRangeDays): void {
    if (!Number.isFinite(maxDays)) return;
    const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (days > maxDays) {
      throw new BooksyError(
        'safe_mode_limit',
        `Safe mode reads at most ${maxDays} days at once, and this range has ${days}. Split it ` +
          'into shorter ranges.',
      );
    }
  }

  invalidate(): void {
    this.cache.clear();
  }

  status(): TrafficStatus {
    const { traffic, ledger } = this;
    const status: TrafficStatus = {
      mode: traffic.safeMode ? 'safe' : 'unrestricted',
      requests_this_hour: {
        used: ledger.count('requests', HOUR_MS),
        limit: limit(traffic.maxRequestsPerHour),
      },
      requests_last_24h: {
        used: ledger.count('requests', DAY_MS),
        limit: limit(traffic.maxRequestsPerDay),
      },
      exports_last_24h: {
        used: ledger.count('exports', DAY_MS),
        limit: limit(traffic.maxExportsPerDay),
      },
      cooldown: this.breaker.status(),
      limits: {
        min_interval_ms: traffic.minIntervalMs,
        write_interval_ms: traffic.writeIntervalMs,
        export_interval_ms: traffic.exportIntervalMs,
        max_pages_per_call: limit(traffic.maxPagesPerCall),
        max_range_days: limit(traffic.maxRangeDays),
        max_background_ms: limit(traffic.maxBackgroundMs),
      },
    };
    if (!traffic.safeMode) status.warning = SAFE_MODE_OFF_WARNING;
    return status;
  }

  private mayUseCache(key: string, fresh: boolean): boolean {
    if (!fresh) return true;
    const age = this.cache.ageSeconds(key);
    return age !== undefined && age < this.traffic.minFreshSeconds;
  }

  private countPage(): void {
    const call = this.calls.getStore();
    if (!call) return;
    call.pages += 1;
    if (call.pages > this.traffic.maxPagesPerCall) {
      throw new BooksyError(
        'safe_mode_limit',
        `Safe mode lets one tool call make ${this.traffic.maxPagesPerCall} requests. Narrow it down ` +
          'and call it again for the rest.',
      );
    }
  }

  private guard(): { maxBackgroundMs?: number } {
    const { maxBackgroundMs } = this.traffic;
    return Number.isFinite(maxBackgroundMs) ? { maxBackgroundMs } : {};
  }

  private taskKind(rule: Rule): TaskKind {
    if (rule.kind === 'write') return 'write';
    return rule.report ? 'export' : 'read';
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
    this.countPage();
    const request = { ...buildRequest(rule, options), ...this.guard() };
    const timeoutMs = rule.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = await this.limiter.schedule(
      () => this.bridge.call({ type: 'call', request }, timeoutMs),
      { kind: this.taskKind(rule) },
    );
    this.remember(result.context);
    if (!result.ok) throw this.toError(result);
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
      const cooldown = this.traffic.blockCooldownMs;
      this.breaker.trip(status === 429 ? 'a 429 answer from Booksy' : 'a block answer from Booksy', cooldown);
      return new BooksyError(
        'blocked_by_booksy',
        `Booksy refused the request as automated or too frequent. All requests are paused for ` +
          `${describe(cooldown)}, and nothing is retried. Check the panel in your browser.`,
      );
    }
    if (status === 403) {
      const cooldown = this.traffic.forbiddenCooldownMs;
      this.breaker.trip('a 403 answer from Booksy', cooldown);
      return new BooksyError(
        'blocked_by_booksy',
        `Booksy answered 403. All requests are paused for ${describe(cooldown)}, and nothing is ` +
          'retried. This login may not have access to that screen. Check the panel in your browser.',
        body,
      );
    }
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
