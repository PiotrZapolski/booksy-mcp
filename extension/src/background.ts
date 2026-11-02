/**
 * Service worker. Connects to the local server, proves who it is, and runs allowed calls in the
 * panel tab. It never stores responses and keeps no data beyond the bridge settings.
 */
import { resolveRule } from '../../src/shared/allowlist.js';
import {
  type ChatRequest,
  type PanelRequest,
  type PanelResult,
  PING_INTERVAL_MS,
  PROOF_CLIENT,
  PROOF_SERVER,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '../../src/shared/protocol.js';
import { hmacHex, randomHex } from './crypto.js';
import { unattended } from './guard.js';
import { pageCall, pageChat, pageContext, pageFrameRequests } from './page.js';

const DEFAULT_PORT = 47821;
const PANEL_URL = 'https://booksy.com/pro/*';
const CHAT_BASE = 'https://chat.stream-io-api.com';
const RECONNECT_ALARM = 'reconnect';

interface Settings {
  port: number;
  secret?: string;
  allowWrites: boolean;
  pendingCode?: string;
}

interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'pairing_failed';
  detail?: string;
}

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let state: ConnectionState = { status: 'disconnected' };

async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['port', 'secret', 'allowWrites', 'pendingCode']);
  const settings: Settings = {
    port: typeof stored.port === 'number' ? stored.port : DEFAULT_PORT,
    allowWrites: stored.allowWrites === true,
  };
  if (typeof stored.secret === 'string') settings.secret = stored.secret;
  if (typeof stored.pendingCode === 'string') settings.pendingCode = stored.pendingCode;
  return settings;
}

function setState(next: ConnectionState): void {
  state = next;
  void chrome.storage.session.set({ connection: state });
}

async function connect(): Promise<void> {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  const settings = await loadSettings();
  if (!settings.secret && !settings.pendingCode) {
    setState({ status: 'disconnected', detail: 'Enter the pairing code.' });
    return;
  }

  setState({ status: 'connecting' });
  const ws = new WebSocket(`ws://127.0.0.1:${settings.port}`);
  socket = ws;
  const clientNonce = randomHex(32);
  let serverNonce = '';
  let authenticated = false;

  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    void onMessage(message);
  };

  const onMessage = async (message: ServerMessage): Promise<void> => {
    if (message.type === 'challenge') {
      serverNonce = message.serverNonce;
      if (settings.secret) {
        const proof = await hmacHex(settings.secret, PROOF_CLIENT, serverNonce, clientNonce);
        send(ws, { type: 'resume', protocol: PROTOCOL_VERSION, clientNonce, proof });
      } else if (settings.pendingCode) {
        send(ws, {
          type: 'pair',
          protocol: PROTOCOL_VERSION,
          code: settings.pendingCode,
          clientNonce,
        });
      }
      return;
    }
    if (message.type === 'paired') {
      const expected = await hmacHex(message.secret, PROOF_SERVER, clientNonce, serverNonce);
      if (expected !== message.proof) return ws.close();
      await chrome.storage.local.set({ secret: message.secret });
      await chrome.storage.local.remove('pendingCode');
      authenticated = true;
      return setState({ status: 'connected' });
    }
    if (message.type === 'welcome') {
      const secret = settings.secret as string;
      const expected = await hmacHex(secret, PROOF_SERVER, clientNonce, serverNonce);
      if (expected !== message.proof) return ws.close();
      authenticated = true;
      return setState({ status: 'connected' });
    }
    if (message.type === 'rejected') {
      await chrome.storage.local.remove('pendingCode');
      return setState({ status: 'pairing_failed', detail: message.reason });
    }
    // Commands are ignored until the server has proved it holds the shared secret.
    if (!authenticated) return;
    if (message.type === 'call') return reply(ws, message.id, handleCall(message.request));
    if (message.type === 'chat') return reply(ws, message.id, handleChat(message.request));
    if (message.type === 'context') return reply(ws, message.id, handleContext());
    if (message.type === 'frames') return reply(ws, message.id, handleFrames());
  };

  ws.onopen = () => {
    pingTimer = setInterval(() => send(ws, { type: 'ping' }), PING_INTERVAL_MS);
  };
  ws.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (socket === ws) socket = null;
    if (state.status !== 'pairing_failed') setState({ status: 'disconnected' });
  };
  ws.onerror = () => ws.close();
}

function send(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

async function reply(ws: WebSocket, id: string, work: Promise<PanelResult>): Promise<void> {
  let result: PanelResult;
  try {
    result = await work;
  } catch (error) {
    result = { ok: false, failure: 'request_failed', message: (error as Error).message };
  }
  send(ws, { type: 'result', id, result });
}

async function panelTab(): Promise<chrome.tabs.Tab | PanelResult> {
  const tabs = await chrome.tabs.query({ url: PANEL_URL });
  if (tabs.length === 0) return { ok: false, failure: 'tab_missing' };
  const alive = tabs.filter((tab) => !tab.discarded);
  if (alive.length === 0) return { ok: false, failure: 'tab_discarded' };
  const active = alive.find((tab) => tab.active);
  if (active) return active;
  return [...alive].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] as chrome.tabs.Tab;
}

function isFailure(value: chrome.tabs.Tab | PanelResult): value is PanelResult {
  return 'ok' in value;
}

async function isUnattended(tab: chrome.tabs.Tab, maxBackgroundMs: number): Promise<boolean> {
  const seconds = Math.max(15, Math.ceil(maxBackgroundMs / 1000));
  const [window, computer] = await Promise.all([
    chrome.windows.get(tab.windowId),
    chrome.idle.queryState(seconds),
  ]);
  return unattended(
    {
      active: tab.active,
      minimized: window.state === 'minimized',
      lastAccessed: tab.lastAccessed,
      computer,
      now: Date.now(),
    },
    maxBackgroundMs,
  );
}

async function runInTab<A extends unknown[]>(
  func: (...args: A) => PanelResult | Promise<PanelResult>,
  args: A,
  maxBackgroundMs?: number,
): Promise<PanelResult> {
  const tab = await panelTab();
  if (isFailure(tab)) return tab;
  if (tab.id === undefined) return { ok: false, failure: 'tab_missing' };
  if (maxBackgroundMs !== undefined && (await isUnattended(tab, maxBackgroundMs))) {
    return { ok: false, failure: 'panel_in_background' };
  }
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: func as (...args: unknown[]) => unknown,
    args,
  });
  return (frame?.result as PanelResult | undefined) ?? { ok: false, failure: 'panel_not_ready' };
}

async function handleContext(): Promise<PanelResult> {
  return runInTab(pageContext, []);
}

async function handleCall(request: PanelRequest): Promise<PanelResult> {
  let rule;
  try {
    rule = resolveRule(request.ruleId, request.urlParams);
  } catch (error) {
    return { ok: false, failure: 'rule_rejected', message: (error as Error).message };
  }
  if (rule.kind === 'write') {
    const { allowWrites } = await loadSettings();
    if (!allowWrites) return { ok: false, failure: 'writes_disabled_in_extension' };
  }
  const call = { method: rule.method, path: rule.path, request };
  return runInTab(pageCall, [call], request.maxBackgroundMs);
}

async function handleChat(request: ChatRequest): Promise<PanelResult> {
  if (request.chat.action === 'send') {
    const { allowWrites } = await loadSettings();
    if (!allowWrites) return { ok: false, failure: 'writes_disabled_in_extension' };
  }
  return runInTab(pageChat, [request.chat, CHAT_BASE], request.maxBackgroundMs);
}

/**
 * Looks into the report frame, in the extension's isolated world, so this code cannot reach the
 * frame's scripts or its stores. Frames on other hosts are skipped by Chrome, because the extension
 * has no permission for them. That includes the gateway frame that keeps the session.
 */
async function handleFrames(): Promise<PanelResult> {
  const tab = await panelTab();
  if (isFailure(tab)) return tab;
  if (tab.id === undefined) return { ok: false, failure: 'tab_missing' };
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: pageFrameRequests,
  });
  return { ok: true, data: results.flatMap((entry) => entry.result ?? []) };
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  void connect();
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  void connect();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connect();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.pendingCode?.newValue || changes.port) {
    socket?.close();
    socket = null;
    void connect();
  }
});

void connect();
