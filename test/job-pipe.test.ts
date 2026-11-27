import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Pairing } from '../src/bridge/pairing.js';
import { BridgeServer } from '../src/bridge/server.js';
import { DEFAULT_EXTENSION_ID } from '../src/config.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/shared/protocol.js';
import { CONTEXT, tempDir } from './helpers.js';

const VISITS = 3000;
const cache = resolve('node_modules/.cache');
let build = '';

// Compiled inside the repository, so the output finds node_modules and "type": "module".
beforeAll(() => {
  mkdirSync(cache, { recursive: true });
  build = mkdtempSync(join(cache, 'job-pipe-'));
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', build]);
}, 120_000);

afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

function calendar() {
  const bookings = Object.fromEntries(
    Array.from({ length: VISITS }, (_, index) => [
      String(index + 1),
      {
        appointment_uid: 10_000 + index,
        status: 'A',
        booked_from: '2026-11-23 10:00:00',
        booked_till: '2026-11-23 10:45:00',
        service: { name: 'Strzyżenie włosów i brody '.repeat(3) },
        resources: [{ id: 7 }],
        customer: { id: index + 1, name: `Klient ${index + 1}`, phone: '+48 600 000 000' },
      },
    ]),
  );
  return { bookings, reservations: {}, resources: [{ id: 7, name: 'Bartek', time_offs: {} }] };
}

/** Pairs like the extension does and answers the panel calls. */
function fakeExtension(port: number, code: string, onCalendar: () => void): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { Origin: `chrome-extension://${DEFAULT_EXTENSION_ID}` },
  });
  return new Promise((done, reject) => {
    socket.on('error', reject);
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.type === 'challenge') {
        const clientNonce = randomBytes(16).toString('hex');
        socket.send(JSON.stringify({ type: 'pair', protocol: PROTOCOL_VERSION, code, clientNonce }));
      } else if (message.type === 'paired') {
        done(socket);
      } else if (message.type === 'context' || message.type === 'call') {
        const isCall = message.type === 'call';
        const result = { ok: true, context: CONTEXT, ...(isCall ? { data: calendar() } : {}) };
        socket.send(JSON.stringify({ type: 'result', id: message.id, result }));
        if (isCall) onCalendar();
      }
    });
  });
}

describe('compiled job writing to a pipe', () => {
  it('prints a large agenda in full before it exits', async () => {
    const configDir = tempDir();
    const pairing = new Pairing(join(configDir, 'bridge-secret'));
    const server = new BridgeServer({ port: 0, extensionIds: [DEFAULT_EXTENSION_ID] }, pairing);
    await server.start();
    let answered = (): void => undefined;
    const calendarSent = new Promise<void>((done) => {
      answered = done;
    });
    const extension = await fakeExtension(server.port(), server.status().pairingCode ?? '', () => answered());
    // The port is taken by the server above, so the job works through it as a relay.
    const child = spawn(
      process.execPath,
      [join(build, 'index.js'), 'job', '--agenda', '--from', '2026-11-23', '--to', '2026-11-23', '--details-limit', '0'],
      {
        env: { PATH: process.env.PATH, BOOKSY_MCP_CONFIG_DIR: configDir, BOOKSY_MCP_PORT: String(server.port()) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    try {
      let errors = '';
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        errors += chunk;
      });
      const closed = new Promise<number | null>((done) => child.on('close', done));
      await Promise.race([calendarSent, closed]);
      // Nobody reads stdout yet: the pipe fills up while the job wants to finish.
      await new Promise((done) => setTimeout(done, 1500));
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      const code = await closed;
      const output = Buffer.concat(chunks);

      expect(code, errors).toBe(0);
      expect(output.length).toBeGreaterThan(500_000);
      const payload = JSON.parse(output.toString('utf8')) as { visits: unknown[] };
      expect(payload.visits).toHaveLength(VISITS);
    } finally {
      child.kill();
      extension.terminate();
      await server.stop();
    }
  }, 60_000);
});
