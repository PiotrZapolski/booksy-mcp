import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { BooksyError } from '../errors.js';
import {
  type ChatRequest,
  type ClientMessage,
  type PanelRequest,
  type PanelResult,
  PROOF_CLIENT,
  PROOF_SERVER,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '../shared/protocol.js';
import { type Pairing, proof, safeEqual } from './pairing.js';

const AUTH_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_SOCKETS = 3;
const RESPONSE_MARGIN_MS = 5_000;

export type BridgeCall =
  | { type: 'call'; request: PanelRequest }
  | { type: 'chat'; request: ChatRequest }
  | { type: 'context' };

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

  constructor(
    private readonly options: { port: number; extensionIds: string[] },
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
          const allowed =
            isAllowedHost(req.headers.host, this.port()) &&
            isAllowedOrigin(req.headers.origin, this.options.extensionIds) &&
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
      server.on('connection', (socket) => this.accept(socket));
    });
  }

  async stop(): Promise<void> {
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
    const socket = this.active;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(this.notConnected());
    }
    const id = randomUUID();
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
      this.send(socket, { ...message, id } as ServerMessage);
    });
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

  private accept(socket: WebSocket): void {
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
        this.handle(socket, message);
        return;
      }
      const secret = this.authenticate(socket, message, serverNonce);
      if (secret === null) {
        giveUp('auth_failed');
        return;
      }
      authenticated = true;
      clearTimeout(deadline);
      this.unauthenticated -= 1;
      this.promote(socket);
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

  private promote(socket: WebSocket): void {
    const previous = this.active;
    this.active = socket;
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
