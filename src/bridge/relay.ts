import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { type ErrorCode, BooksyError } from '../errors.js';
import {
  type PanelResult,
  PROOF_RELAY,
  PROOF_SERVER,
  PROTOCOL_VERSION,
  type RelayReply,
} from '../shared/protocol.js';
import type { Pairing } from './pairing.js';
import { proof, safeEqual } from './pairing.js';
import type { Bridge, BridgeCall } from './server.js';

const CONNECT_TIMEOUT_MS = 10_000;
const RESPONSE_MARGIN_MS = 10_000;

interface Pending {
  resolve(result: PanelResult): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * The bridge of a second booksy-mcp process. When an MCP server already holds the port, a job
 * connects to it as a relay: it proves the shared pairing secret, and the server passes its calls
 * to the extension in the same one-at-a-time line as its own. There is one pairing and one
 * extension connection, whoever started first.
 */
export class RelayBridge implements Bridge {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly options: { port: number },
    private readonly pairing: Pairing,
  ) {}

  /** Connects and authenticates. Throws a BooksyError when the holder of the port is not a booksy-mcp. */
  async connect(): Promise<void> {
    const secret = this.pairing.secret();
    if (!secret) {
      throw new BooksyError(
        'bridge_not_connected',
        'The port is taken and there is no pairing yet. Pair the extension first.',
      );
    }
    const socket = new WebSocket(`ws://127.0.0.1:${this.options.port}`);
    const clientNonce = randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) => {
      const fail = (message: string): void => {
        clearTimeout(timer);
        socket.terminate();
        reject(new BooksyError('bridge_port_busy', message));
      };
      const timer = setTimeout(
        () => fail(`Port ${this.options.port} is taken by something that does not answer as booksy-mcp.`),
        CONNECT_TIMEOUT_MS,
      );
      let serverNonce = '';
      socket.on('error', () =>
        fail(`Port ${this.options.port} is taken, and the relay could not connect to it.`),
      );
      socket.on('close', () => fail(`The booksy-mcp on port ${this.options.port} refused the relay.`));
      socket.on('message', (raw) => {
        const message = parseJson(raw.toString());
        if (!message) return;
        if (message.type === 'challenge' && typeof message.serverNonce === 'string') {
          serverNonce = message.serverNonce;
          socket.send(
            JSON.stringify({
              type: 'relay',
              protocol: PROTOCOL_VERSION,
              clientNonce,
              proof: proof(secret, PROOF_RELAY, serverNonce, clientNonce),
            }),
          );
          return;
        }
        if (message.type === 'welcome') {
          const expected = proof(secret, PROOF_SERVER, clientNonce, serverNonce);
          if (typeof message.proof !== 'string' || !safeEqual(expected, message.proof)) {
            fail('The process on the port could not prove the pairing secret.');
            return;
          }
          clearTimeout(timer);
          socket.removeAllListeners();
          this.attach(socket);
          resolve();
          return;
        }
        if (message.type === 'rejected') fail('The booksy-mcp on the port refused the relay.');
      });
    });
  }

  call(message: BridgeCall, timeoutMs: number): Promise<PanelResult> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new BooksyError('bridge_not_connected', 'The relay to the running booksy-mcp is closed.'),
      );
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BooksyError('bridge_timeout', 'The running booksy-mcp did not answer in time.'));
      }, timeoutMs + RESPONSE_MARGIN_MS);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'relay_call', id, call: message, timeoutMs }));
    });
  }

  async stop(): Promise<void> {
    this.socket?.close();
    this.socket = null;
  }

  private attach(socket: WebSocket): void {
    this.socket = socket;
    socket.on('message', (raw) => {
      const reply = parseJson(raw.toString()) as RelayReply | null;
      if (!reply || typeof reply.id !== 'string') return;
      const entry = this.pending.get(reply.id);
      if (!entry) return;
      this.pending.delete(reply.id);
      clearTimeout(entry.timer);
      if (reply.type === 'relay_result') entry.resolve(reply.result);
      else entry.reject(new BooksyError(reply.code as ErrorCode, reply.message));
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new BooksyError('bridge_not_connected', 'The running booksy-mcp closed the relay.'));
        this.pending.delete(id);
      }
    });
    socket.on('error', () => socket.terminate());
  }
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return value && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}
