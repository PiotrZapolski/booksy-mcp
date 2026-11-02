/** Wire protocol between the local server and the browser extension. */
export const PROTOCOL_VERSION = 1;

export const PING_INTERVAL_MS = 20_000;

/** A request names a rule from the allowlist. It can never carry a raw URL. */
export interface PanelRequest {
  ruleId: string;
  urlParams?: Record<string, string>;
  params?: Record<string, QueryValue>;
  data?: unknown;
  binary?: boolean;
  timeoutMs?: number;
  /** Refuse the call when the panel tab or the computer has been unused for longer than this. */
  maxBackgroundMs?: number;
}

export type QueryValue = string | number | boolean | Array<string | number>;

export interface PanelContext {
  country: string | null;
  language: string | null;
  businessId: string | null;
  businessName: string | null;
  timezone: string | null;
  userId: string | null;
  accessLevel: string | null;
}

export type PanelFailure =
  | 'panel_not_ready'
  | 'not_logged_in'
  | 'captcha_protected'
  | 'request_failed'
  | 'tab_missing'
  | 'tab_discarded'
  | 'rule_rejected'
  | 'writes_disabled_in_extension'
  | 'panel_in_background'
  | 'chat_failed';

export interface PanelResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  base64?: string;
  contentType?: string;
  filename?: string;
  failure?: PanelFailure;
  message?: string;
  context?: PanelContext;
}

export type ChatAction =
  | { action: 'list'; limit: number; offset: number }
  | { action: 'read'; channelId: string; limit: number }
  | { action: 'send'; channelId: string; text: string };

export interface ChatRequest {
  chat: ChatAction;
  timeoutMs?: number;
  maxBackgroundMs?: number;
}

/** What a frame asked for by itself: address shapes only, no ids, no parameter values, no headers. */
export interface FrameRequests {
  host: string;
  requests: Array<{ path: string; params: string[]; count: number; status: number | null }>;
}

/** Extension to server. */
export type ClientMessage =
  | { type: 'pair'; protocol: number; code: string; clientNonce: string }
  | { type: 'resume'; protocol: number; clientNonce: string; proof: string }
  | { type: 'result'; id: string; result: PanelResult }
  | { type: 'ping' };

/** Server to extension. */
export type ServerMessage =
  | { type: 'challenge'; serverNonce: string }
  | { type: 'paired'; secret: string; proof: string }
  | { type: 'welcome'; proof: string }
  | { type: 'rejected'; reason: string }
  | { type: 'call'; id: string; request: PanelRequest }
  | { type: 'chat'; id: string; request: ChatRequest }
  | { type: 'context'; id: string }
  | { type: 'frames'; id: string }
  | { type: 'pong' };

export const PROOF_CLIENT = 'booksy-mcp/client';
export const PROOF_SERVER = 'booksy-mcp/server';
