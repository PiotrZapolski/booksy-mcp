import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CODE_TTL_MS, MAX_ATTEMPTS, Pairing, proof } from '../src/bridge/pairing.js';
import { BridgeServer, isAllowedHost, isAllowedOrigin } from '../src/bridge/server.js';
import { PROOF_CLIENT, PROOF_SERVER, PROTOCOL_VERSION } from '../src/shared/protocol.js';
import { tempDir } from './helpers.js';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXT}`;
const open: BridgeServer[] = [];

async function startBridge() {
  const pairing = new Pairing(join(tempDir(), 'secret'));
  const bridge = new BridgeServer({ port: 0, extensionIds: [EXT] }, pairing);
  await bridge.start();
  open.push(bridge);
  return { bridge, pairing, port: bridge.port() };
}

function connect(port: number, headers: Record<string, string> = { Origin: ORIGIN }) {
  return new WebSocket(`ws://127.0.0.1:${port}`, { headers });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    ws.once('error', reject);
  });
}

function outcome(ws: WebSocket): Promise<'open' | 'refused'> {
  return new Promise((resolve) => {
    ws.once('open', () => resolve('open'));
    ws.once('error', () => resolve('refused'));
  });
}

async function pair(port: number, code: string) {
  const ws = connect(port);
  const challenge = await nextMessage(ws);
  const clientNonce = randomBytes(16).toString('hex');
  ws.send(JSON.stringify({ type: 'pair', protocol: PROTOCOL_VERSION, code, clientNonce }));
  return { ws, reply: await nextMessage(ws), serverNonce: challenge.serverNonce as string, clientNonce };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((bridge) => bridge.stop()));
});

describe('connection checks', () => {
  it('accepts only loopback hosts on the right port', () => {
    expect(isAllowedHost('127.0.0.1:47821', 47821)).toBe(true);
    expect(isAllowedHost('localhost:47821', 47821)).toBe(true);
    expect(isAllowedHost('evil.example:47821', 47821)).toBe(false);
    expect(isAllowedHost('127.0.0.1:1', 47821)).toBe(false);
    expect(isAllowedHost(undefined, 47821)).toBe(false);
  });

  it('accepts only the pinned extension origin', () => {
    expect(isAllowedOrigin(ORIGIN, [EXT])).toBe(true);
    expect(isAllowedOrigin('https://booksy.com', [EXT])).toBe(false);
    expect(isAllowedOrigin('chrome-extension://other', [EXT])).toBe(false);
    expect(isAllowedOrigin(undefined, [EXT])).toBe(false);
  });

  it('refuses a web page origin at the socket level', async () => {
    const { port } = await startBridge();
    expect(await outcome(connect(port, { Origin: 'https://evil.example' }))).toBe('refused');
  });

  it('refuses a wrong Host header at the socket level', async () => {
    const { port } = await startBridge();
    const ws = connect(port, { Origin: ORIGIN, Host: 'evil.example' });
    expect(await outcome(ws)).toBe('refused');
  });

  it('listens on loopback only', async () => {
    const { bridge } = await startBridge();
    const address = (bridge as unknown as { server: { address(): { address: string } } }).server.address();
    expect(address.address).toBe('127.0.0.1');
  });
});

describe('pairing', () => {
  it('pairs with the right code, then the code stops working', async () => {
    const { bridge, port } = await startBridge();
    const code = bridge.status().pairingCode as string;
    const { reply, ws, serverNonce, clientNonce } = await pair(port, code);
    expect(reply.type).toBe('paired');
    expect(reply.proof).toBe(
      proof(reply.secret as string, PROOF_SERVER, clientNonce, serverNonce),
    );
    expect(bridge.status()).toMatchObject({ paired: true, connected: true, pairingCode: null });
    ws.close();
  });

  it('refuses a wrong code and closes', async () => {
    const { port } = await startBridge();
    const { reply } = await pair(port, 'WRONGCOD');
    expect(reply).toMatchObject({ type: 'rejected', reason: 'auth_failed' });
  });

  it('rotates the code after too many wrong attempts', () => {
    const pairing = new Pairing(join(tempDir(), 'secret'));
    const first = pairing.currentCode();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) expect(pairing.redeem('NOPE')).toBeNull();
    expect(pairing.currentCode()).not.toBe(first);
  });

  it('expires the code', () => {
    let time = 0;
    const pairing = new Pairing(join(tempDir(), 'secret'), () => time);
    const code = pairing.currentCode() as string;
    time = CODE_TTL_MS + 1;
    expect(pairing.redeem(code)).toBeNull();
  });
});

describe('resume', () => {
  it('requires a proof of the secret and answers with its own proof', async () => {
    const { bridge, pairing, port } = await startBridge();
    const code = bridge.status().pairingCode as string;
    const first = await pair(port, code);
    first.ws.close();
    const secret = pairing.secret() as string;

    const ws = connect(port);
    const { serverNonce } = (await nextMessage(ws)) as { serverNonce: string };
    const clientNonce = randomBytes(16).toString('hex');
    ws.send(
      JSON.stringify({
        type: 'resume',
        protocol: PROTOCOL_VERSION,
        clientNonce,
        proof: proof(secret, PROOF_CLIENT, serverNonce, clientNonce),
      }),
    );
    const welcome = await nextMessage(ws);
    expect(welcome).toEqual({
      type: 'welcome',
      proof: proof(secret, PROOF_SERVER, clientNonce, serverNonce),
    });
    ws.close();
  });

  it('refuses a replayed or made-up proof', async () => {
    const { bridge, port } = await startBridge();
    (await pair(port, bridge.status().pairingCode as string)).ws.close();

    const ws = connect(port);
    await nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: 'resume',
        protocol: PROTOCOL_VERSION,
        clientNonce: 'aa',
        proof: 'f'.repeat(64),
      }),
    );
    expect(await nextMessage(ws)).toMatchObject({ type: 'rejected' });
  });
});

describe('calls', () => {
  it('sends a command only to an authenticated client and returns its answer', async () => {
    const { bridge, port } = await startBridge();
    const paired = await pair(port, bridge.status().pairingCode as string);
    paired.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'context') {
        paired.ws.send(
          JSON.stringify({ type: 'result', id: message.id, result: { ok: true, status: 200 } }),
        );
      }
    });
    await expect(bridge.call({ type: 'context' }, 1000)).resolves.toEqual({ ok: true, status: 200 });
    paired.ws.close();
  });

  it('explains when nothing is connected', async () => {
    const { bridge } = await startBridge();
    await expect(bridge.call({ type: 'context' }, 100)).rejects.toMatchObject({
      code: 'bridge_not_connected',
    });
  });

  it('fails waiting calls when the extension drops', async () => {
    const { bridge, port } = await startBridge();
    const paired = await pair(port, bridge.status().pairingCode as string);
    const waiting = bridge.call({ type: 'context' }, 5000);
    paired.ws.terminate();
    await expect(waiting).rejects.toMatchObject({ code: 'bridge_not_connected' });
  });

  it('reports a busy port and stays up', async () => {
    const first = await startBridge();
    const second = new BridgeServer(
      { port: first.port, extensionIds: [EXT] },
      new Pairing(join(tempDir(), 'secret')),
    );
    await second.start();
    expect(second.status().portBusy).toBe(true);
    await expect(second.call({ type: 'context' }, 100)).rejects.toMatchObject({
      code: 'bridge_port_busy',
    });
  });
});
