import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { BooksyError } from '../errors.js';
import {
  type ClientMessage,
  PANEL_HOME,
  type PanelResult,
  PROOF_CLIENT,
  PROOF_RELAY,
  PROOF_SERVER,
  PROTOCOL_VERSION,
  type RelayCall,
  type RelayMessage,
  type RelayReply,
  type ServerMessage,
} from '../shared/protocol.js';
import { type Pairing, proof, safeEqual } from './pairing.js';

const AUTH_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_SOCKETS = 3;
const RESPONSE_MARGIN_MS = 5_000;
/** Longest call a relay may ask for. An export is the slowest call, at a few minutes. */
const MAX_RELAY_TIMEOUT_MS = 10 * 60 * 1000;
const RELAY_CALLS = new Set(['call', 'chat', 'context', 'frames', 'open_panel', 'close_panel']);
/** How long a call waits for the extension to (re)connect before it gives up. */
export const DEFAULT_CONNECT_WAIT_MS = 12_000;

export type BridgeCall = RelayCall;

export interface Bridge {
  call(message: BridgeCall, timeoutMs: number): Promise<PanelResult>;
}

export interface BridgeStatus {
  listening: boolean;
  portBusy: boolean;
  port: number;
  paired: boolean;
  connected: boolean;
  pairingCode: string | null;
}

interface Pending {
  resolve(result: PanelResult): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function isAllowedOrigin(origin: string | undefined, extensionIds: string[]): boolean {
  if (!origin) return false;
  return extensionIds.some((id) => origin === `chrome-extension://${id}`);
}

export class BridgeServer implements Bridge {
  private server: WebSocketServer | null = null;
  private active: WebSocket | null = null;
  private portBusy = false;
  private unauthenticated = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly connectWaiters = new Set<() => void>();
  /** Calls go to the extension one at a time, also when a relay sends some of them. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: { port: number; extensionIds: string[]; connectWaitMs?: number },
    private readonly pairing: Pairing,
  ) {}

  /** Resolves also when the port is taken, so the MCP server stays up and can explain it. */
  start(): Promise<void> {
    return new Promise((resolve) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: this.options.port,
        maxPayload: MAX_FRAME_BYTES,
        perMessageDeflate: false,
        verifyClient: ({ req }: { req: IncomingMessage }, done) => {
          // A browser always sends an Origin. Only the extension's origin is let in, and a local
          // process without an Origin may only authenticate as a relay.
          const origin = req.headers.origin;
          const allowed =
            isAllowedHost(req.headers.host, this.port()) &&
            (origin === undefined || isAllowedOrigin(origin, this.options.extensionIds)) &&
            this.unauthenticated < MAX_PENDING_SOCKETS;
          done(allowed, 403, 'Forbidden');
        },
      });
      server.once('listening', () => {
        this.server = server;
        server.on('error', () => undefined);
        resolve();
      });
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.portBusy = error.code === 'EADDRINUSE';
        resolve();
      });
      server.on('connection', (socket, req) => this.accept(socket, req.headers.origin === undefined));
    });
  }

  async stop(): Promise<void> {
    for (const wake of [...this.connectWaiters]) wake();
    for (const client of this.server?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
    this.server = null;
  }

  port(): number {
    const address = this.server?.address();
    return typeof address === 'object' && address ? address.port : this.options.port;
  }

  status(): BridgeStatus {
    return {
      listening: this.server !== null,
      portBusy: this.portBusy,
      port: this.port(),
      paired: this.pairing.secret() !== null,
      connected: this.active?.readyState === WebSocket.OPEN,
      pairingCode: this.pairing.currentCode(),
    };
  }

  call(message: BridgeCall, timeoutMs: number): Promise<PanelResult> {
    const run = (): Promise<PanelResult> => this.callNow(message, timeoutMs);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async callNow(message: BridgeCall, timeoutMs: number): Promise<PanelResult> {
    const socket = await this.connectedSocket();
    const id = randomUUID();
    const wire = (
      message.type === 'open_panel' ? { type: 'open_panel', id, url: PANEL_HOME } : { ...message, id }
    ) as ServerMessage;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BooksyError(
            'bridge_timeout',
            'The browser did not answer in time. Check that the panel tab is open and not frozen.',
          ),
        );
      }, timeoutMs + RESPONSE_MARGIN_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send(socket, wire);
    });
  }

  /**
   * After a client restart the extension needs a moment to reconnect. A paired extension is given
   * a short time to do so before the call fails. Before pairing nobody can connect, so it fails at once.
   */
  private async connectedSocket(): Promise<WebSocket> {
    const open = (): WebSocket | null =>
      this.active?.readyState === WebSocket.OPEN ? this.active : null;
    const ready = open();
    if (ready) return ready;
    const wait = this.options.connectWaitMs ?? DEFAULT_CONNECT_WAIT_MS;
    if (wait > 0 && !this.portBusy && this.server && this.pairing.secret() !== null) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          this.connectWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, wait);
        this.connectWaiters.add(done);
      });
      const late = open();
      if (late) return late;
    }
    throw this.notConnected();
  }

  private notConnected(): BooksyError {
    if (this.portBusy) {
      return new BooksyError(
        'bridge_port_busy',
        `Port ${this.options.port} is used by another booksy-mcp. Close the other MCP client or set ` +
          'BOOKSY_MCP_PORT and the same port in the extension.',
      );
    }
    return new BooksyError(
      'bridge_not_connected',
      'The browser extension is not connected. Open Chrome with the extension installed. ' +
        'Use session_status to see the pairing code if it is the first run.',
    );
  }

  private accept(socket: WebSocket, relay: boolean): void {
    this.unauthenticated += 1;
    const serverNonce = randomBytes(32).toString('hex');
    let authenticated = false;

    const giveUp = (reason: string): void => {
      this.send(socket, { type: 'rejected', reason });
      socket.close(4001, reason);
    };

    const deadline = setTimeout(() => giveUp('auth_timeout'), AUTH_TIMEOUT_MS);
    this.send(socket, { type: 'challenge', serverNonce });

    socket.on('message', (raw) => {
      const message = parse(raw.toString());
      if (!message) return;
      if (authenticated) {
        if (relay) void this.handleRelay(socket, message as unknown as RelayMessage);
        else this.handle(socket, message);
        return;
      }
      const secret = relay
        ? this.authenticateRelay(socket, message as unknown as RelayMessage, serverNonce)
        : this.authenticate(socket, message, serverNonce);
      if (secret === null) {
        giveUp('auth_failed');
        return;
      }
      authenticated = true;
      clearTimeout(deadline);
      this.unauthenticated -= 1;
      if (!relay) this.promote(socket);
    });

    socket.on('close', () => {
      clearTimeout(deadline);
      if (!authenticated) this.unauthenticated -= 1;
      if (this.active === socket) {
        this.active = null;
        this.failPending(this.notConnected());
      }
    });
    socket.on('error', () => socket.terminate());
  }

  private authenticate(
    socket: WebSocket,
    message: ClientMessage,
    serverNonce: string,
  ): string | null {
    if (message.type === 'pair') {
      if (message.protocol !== PROTOCOL_VERSION) return null;
      const secret = this.pairing.redeem(message.code);
      if (!secret) return null;
      this.send(socket, {
        type: 'paired',
        secret,
        proof: proof(secret, PROOF_SERVER, message.clientNonce, serverNonce),
      });
      return secret;
    }
    if (message.type === 'resume') {
      if (message.protocol !== PROTOCOL_VERSION) return null;
      const secret = this.pairing.secret();
      if (!secret) return null;
      const expected = proof(secret, PROOF_CLIENT, serverNonce, message.clientNonce);
      if (!safeEqual(expected, message.proof)) return null;
      this.send(socket, {
        type: 'welcome',
        proof: proof(secret, PROOF_SERVER, message.clientNonce, serverNonce),
      });
      return secret;
    }
    return null;
  }

  private authenticateRelay(
    socket: WebSocket,
    message: RelayMessage,
    serverNonce: string,
  ): string | null {
    if (message.type !== 'relay' || message.protocol !== PROTOCOL_VERSION) return null;
    const secret = this.pairing.secret();
    if (!secret || typeof message.proof !== 'string') return null;
    const expected = proof(secret, PROOF_RELAY, serverNonce, message.clientNonce);
    if (!safeEqual(expected, message.proof)) return null;
    this.send(socket, {
      type: 'welcome',
      proof: proof(secret, PROOF_SERVER, message.clientNonce, serverNonce),
    });
    return secret;
  }

  /** Passes a relay's call on to the extension, through the same one-at-a-time line. */
  private async handleRelay(socket: WebSocket, message: RelayMessage): Promise<void> {
    if (message.type !== 'relay_call' || typeof message.id !== 'string') return;
    const reply = (value: RelayReply): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
    };
    if (!RELAY_CALLS.has(message.call?.type)) {
      reply({ type: 'relay_error', id: message.id, code: 'rule_rejected', message: 'Unknown relay call.' });
      return;
    }
    const timeoutMs = Math.min(Math.max(Number(message.timeoutMs) || 0, 1000), MAX_RELAY_TIMEOUT_MS);
    try {
      const result = await this.call(message.call, timeoutMs);
      reply({ type: 'relay_result', id: message.id, result });
    } catch (error) {
      const code = error instanceof BooksyError ? error.code : 'request_failed';
      reply({ type: 'relay_error', id: message.id, code, message: (error as Error).message });
    }
  }

  private promote(socket: WebSocket): void {
    const previous = this.active;
    this.active = socket;
    for (const wake of [...this.connectWaiters]) wake();
    if (previous && previous !== socket) previous.close(4002, 'replaced');
  }

  private handle(socket: WebSocket, message: ClientMessage): void {
    if (message.type === 'ping') {
      this.send(socket, { type: 'pong' });
      return;
    }
    if (message.type !== 'result') return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message.result);
  }

  private failPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}

function parse(raw: string): ClientMessage | null {
  try {
    const value = JSON.parse(raw) as ClientMessage;
    return value && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}
