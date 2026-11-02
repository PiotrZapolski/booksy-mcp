import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bridge, BridgeCall, BridgeStatus } from '../src/bridge/server.js';
import { type Config, DEFAULT_EXTENSION_ID, UNRESTRICTED_TRAFFIC } from '../src/config.js';
import { SnapshotStore } from '../src/domain/feed.js';
import { Gateway } from '../src/gateway/gateway.js';
import type { PanelContext, PanelResult } from '../src/shared/protocol.js';
import type { ToolContext } from '../src/tools/define.js';
import { Confirmations } from '../src/writes/confirmations.js';

export const CONTEXT: PanelContext = {
  country: 'pl',
  language: 'pl',
  businessId: '1001',
  businessName: 'Sample Barbers',
  timezone: 'Europe/Warsaw',
  userId: '2002',
  accessLevel: 'owner',
};

export class FakeBridge implements Bridge {
  calls: BridgeCall[] = [];
  connected = true;
  constructor(public respond: (call: BridgeCall) => PanelResult = () => ({ ok: true, data: {} })) {}

  async call(message: BridgeCall): Promise<PanelResult> {
    this.calls.push(message);
    if (message.type === 'context') return { ok: true, context: CONTEXT };
    return { context: CONTEXT, ...this.respond(message) };
  }

  status(): BridgeStatus {
    return {
      listening: true,
      portBusy: false,
      port: 47821,
      paired: true,
      connected: this.connected,
      pairingCode: null,
    };
  }

  /** Calls that reached Booksy, without the local context lookups. */
  sent(): BridgeCall[] {
    return this.calls.filter((call) => call.type !== 'context');
  }
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'booksy-mcp-test-'));
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  const dir = tempDir();
  return {
    port: 0,
    extensionIds: [DEFAULT_EXTENSION_ID],
    configDir: dir,
    exportDir: join(dir, 'exports'),
    stateDir: join(dir, 'state'),
    traffic: UNRESTRICTED_TRAFFIC,
    maxResultChars: 150_000,
    maskContacts: false,
    writeTools: [],
    disabledTools: [],
    ...overrides,
  };
}

export function testContext(
  bridge: FakeBridge,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const config = testConfig();
  return {
    gateway: new Gateway(bridge, {
      traffic: UNRESTRICTED_TRAFFIC,
      maskContacts: false,
      sleep: async () => undefined,
    }),
    config,
    confirmations: new Confirmations(),
    snapshots: new SnapshotStore(join(config.stateDir)),
    bridgeStatus: () => bridge.status(),
    now: () => new Date('2026-11-02T10:00:00Z'),
    ...overrides,
  };
}
