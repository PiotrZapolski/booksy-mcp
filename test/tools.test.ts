import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../src/exports/sheet.js';
import { SAFE_TRAFFIC, type TrafficPolicy } from '../src/config.js';
import { BooksyError } from '../src/errors.js';
import { createServer, toToolResult } from '../src/server.js';
import { Gateway } from '../src/gateway/gateway.js';
import { ALL_TOOLS, selectTools } from '../src/tools/index.js';
import type { BridgeCall } from '../src/bridge/server.js';
import { FakeBridge, testConfig, testContext } from './helpers.js';
import { sampleWorkbook } from './exports.test.js';

const tool = (name: string) => {
  const found = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return found;
};

const rule = (call: BridgeCall | undefined): string | undefined =>
  call?.type === 'call' ? call.request.ruleId : undefined;

describe('tool selection', () => {
  it('has no write tool by default', () => {
    expect(selectTools({ writeTools: [], disabledTools: [] }).filter((t) => t.write)).toEqual([]);
  });

  it('enables a single write by name', () => {
    const names = selectTools({ writeTools: ['appointment_move'], disabledTools: [] })
      .filter((t) => t.write)
      .map((t) => t.name);
    expect(names).toEqual(['appointment_move']);
  });

  it('"all" leaves out tools that reach clients', () => {
    const names = selectTools({ writeTools: ['all'], disabledTools: [] }).map((t) => t.name);
    expect(names).toContain('appointment_cancel');
    expect(names).not.toContain('campaign_send');
    expect(names).not.toContain('chat_reply');
  });

  it('tools that reach clients can be named one by one', () => {
    const names = selectTools({ writeTools: ['campaign_send'], disabledTools: [] }).map((t) => t.name);
    expect(names).toContain('campaign_send');
  });

  it('disabling beats enabling, also for reads', () => {
    const names = selectTools({
      writeTools: ['all'],
      disabledTools: ['appointment_cancel', 'reviews_feed'],
    }).map((t) => t.name);
    expect(names).not.toContain('appointment_cancel');
    expect(names).not.toContain('reviews_feed');
  });

  it('registers only the selected tools with the MCP client', async () => {
    const bridge = new FakeBridge();
    const { server, tools } = createServer(bridge, testConfig());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientSide);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(tools.length);
    expect(listed.tools.some((t) => t.name === 'customer_delete')).toBe(false);
    expect(listed.tools.find((t) => t.name === 'customer_cards')?.annotations?.readOnlyHint).toBe(true);
    await client.close();
  });

  it('returns a readable error through MCP', async () => {
    const bridge = new FakeBridge(() => ({ ok: false, failure: 'tab_missing' }));
    const { server } = createServer(bridge, testConfig());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientSide);
    const result = await client.callTool({ name: 'reviews_feed', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('panel_tab_missing');
    await client.close();
  });
});

describe('dry run and confirm', () => {
  const appointment = {
    appointment: {
      appointment_uid: 'U1',
      _version: 7,
      subbookings: [
        { booked_from: '2026-11-03T10:00', booked_till: '2026-11-03T10:30', staffer_id: 5 },
        { booked_from: '2026-11-03T10:30', booked_till: '2026-11-03T11:00', staffer_id: 5 },
      ],
      payment_info: {},
    },
  };

  function bridgeWithAppointment(data: unknown = appointment) {
    return new FakeBridge((call) => {
      if (rule(call) === 'appointment.read') return { ok: true, data };
      return { ok: true, data: { done: true } };
    });
  }

  const moveArgs = {
    appointment_uid: 'U1',
    new_start: '2026-11-03T12:00',
    notify_customer: false,
  };

  it('a dry run changes nothing and calls the preview endpoint', async () => {
    const bridge = bridgeWithAppointment();
    const result = (await tool('appointment_move').handler(moveArgs, testContext(bridge))) as {
      sent: boolean;
      confirm_token: string;
    };
    expect(result.sent).toBe(false);
    expect(result.confirm_token).toBeTruthy();
    const rules = bridge.sent().map(rule);
    expect(rules).toEqual(['appointment.read', 'appointment.update_preview']);
  });

  it('keeps service lengths when moving and passes the notify choice', async () => {
    const bridge = bridgeWithAppointment();
    const context = testContext(bridge);
    const dry = (await tool('appointment_move').handler(moveArgs, context)) as {
      confirm_token: string;
    };
    await tool('appointment_move').handler(
      { ...moveArgs, mode: 'confirm', confirm_token: dry.confirm_token },
      context,
    );
    const update = bridge.sent().find((call) => rule(call) === 'appointment.update');
    const data = (update as unknown as { request: { data: unknown } }).request.data as {
      subbookings: Array<{ booked_from: string; booked_till: string }>;
      _notification_enabled: boolean;
      _version: number;
    };
    expect(data.subbookings[0]).toMatchObject({ booked_from: '2026-11-03T12:00', booked_till: '2026-11-03T12:30' });
    expect(data.subbookings[1]).toMatchObject({ booked_from: '2026-11-03T12:30', booked_till: '2026-11-03T13:00' });
    expect(data._notification_enabled).toBe(false);
    expect(data._version).toBe(7);
  });

  it('refuses confirm without a token', async () => {
    const bridge = bridgeWithAppointment();
    await expect(
      tool('appointment_move').handler({ ...moveArgs, mode: 'confirm' }, testContext(bridge)),
    ).rejects.toMatchObject({ code: 'invalid_confirmation' });
    expect(bridge.sent().map(rule)).not.toContain('appointment.update');
  });

  it('refuses a token from different arguments', async () => {
    const bridge = bridgeWithAppointment();
    const context = testContext(bridge);
    const dry = (await tool('appointment_move').handler(moveArgs, context)) as {
      confirm_token: string;
    };
    await expect(
      tool('appointment_move').handler(
        { ...moveArgs, new_start: '2026-11-03T15:00', mode: 'confirm', confirm_token: dry.confirm_token },
        context,
      ),
    ).rejects.toMatchObject({ code: 'invalid_confirmation' });
  });

  it('refuses a token from another tool', async () => {
    const bridge = new FakeBridge();
    const context = testContext(bridge);
    const dry = (await tool('customer_delete').handler({ customerId: '5' }, context)) as {
      confirm_token: string;
    };
    await expect(
      tool('time_block_remove').handler(
        { reservationId: '5', mode: 'confirm', confirm_token: dry.confirm_token },
        context,
      ),
    ).rejects.toMatchObject({ code: 'invalid_confirmation' });
  });

  it('a token works once', async () => {
    const bridge = new FakeBridge();
    const context = testContext(bridge);
    const args = { customerId: '5' };
    const dry = (await tool('customer_delete').handler(args, context)) as { confirm_token: string };
    const confirm = { ...args, mode: 'confirm', confirm_token: dry.confirm_token };
    await tool('customer_delete').handler(confirm, context);
    await expect(tool('customer_delete').handler(confirm, context)).rejects.toThrow(/already used/);
    expect(bridge.sent()).toHaveLength(1);
  });

  it('a token expires', async () => {
    const bridge = new FakeBridge();
    const { Confirmations } = await import('../src/writes/confirmations.js');
    let time = 0;
    const context = testContext(bridge, { confirmations: new Confirmations(() => time) });
    const dry = (await tool('customer_delete').handler({ customerId: '5' }, context)) as {
      confirm_token: string;
    };
    time = 301_000;
    await expect(
      tool('customer_delete').handler(
        { customerId: '5', mode: 'confirm', confirm_token: dry.confirm_token },
        context,
      ),
    ).rejects.toThrow(/expired/);
  });

  it('a change to the record between steps invalidates the confirmation', async () => {
    let version = 7;
    const bridge = new FakeBridge((call) =>
      rule(call) === 'appointment.read'
        ? { ok: true, data: { appointment: { ...appointment.appointment, _version: version } } }
        : { ok: true, data: {} },
    );
    const context = testContext(bridge);
    const dry = (await tool('appointment_move').handler(moveArgs, context)) as {
      confirm_token: string;
    };
    version = 8;
    await expect(
      tool('appointment_move').handler(
        { ...moveArgs, mode: 'confirm', confirm_token: dry.confirm_token },
        context,
      ),
    ).rejects.toMatchObject({ code: 'invalid_confirmation' });
  });

  it('stops when the user declines through the client', async () => {
    const bridge = new FakeBridge();
    const context = testContext(bridge, { askUser: async () => false });
    const dry = (await tool('customer_delete').handler({ customerId: '5' }, context)) as {
      confirm_token: string;
    };
    await expect(
      tool('customer_delete').handler(
        { customerId: '5', mode: 'confirm', confirm_token: dry.confirm_token },
        context,
      ),
    ).rejects.toMatchObject({ code: 'declined_by_user' });
    expect(bridge.sent()).toHaveLength(0);
  });

  it('asks for a decision when a deposit is held', async () => {
    const withDeposit = {
      appointment: {
        ...appointment.appointment,
        payment_info: { deposit_info: { id: 3, short_status: 'held' } },
      },
    };
    const args = { appointment_uid: 'U1', notify_by_email: false, notify_by_sms: false };
    const bridge = bridgeWithAppointment(withDeposit);
    await expect(tool('appointment_cancel').handler(args, testContext(bridge))).rejects.toThrow(
      /release_deposit/,
    );
    const result = (await tool('appointment_cancel').handler(
      { ...args, release_deposit: true },
      testContext(bridge),
    )) as { request: { data: Record<string, unknown> } };
    expect(result.request.data).toMatchObject({
      action: 'cancel',
      release_deposit: true,
      _notify_about_cancel_sms: false,
      _version: 7,
    });
  });

  it('sends the panel action names', async () => {
    for (const [name, action] of [
      ['appointment_confirm', 'confirm'],
      ['appointment_decline', 'decline'],
      ['appointment_mark_no_show', 'no_show'],
    ] as const) {
      const result = (await tool(name).handler(
        { appointment_uid: 'U1', notify_customer: false },
        testContext(bridgeWithAppointment()),
      )) as { request: { data: { action: string } } };
      expect(result.request.data.action).toBe(action);
    }
  });

  it('never sends a campaign to an empty audience', async () => {
    const bridge = new FakeBridge();
    await expect(
      tool('campaign_send').handler(
        {
          templateId: '1',
          title: 'T',
          body: 'B',
          body_short: 'S',
          recipients: { customers: [], group: null },
          channel_priority: {},
          with_agreements: true,
        },
        testContext(bridge),
      ),
    ).rejects.toThrow(/empty/);
    expect(bridge.sent()).toHaveLength(0);
  });

  it('a new client is never invited', async () => {
    const bridge = new FakeBridge();
    const result = (await tool('customer_add').handler(
      { first_name: 'A', last_name: 'B', mode: 'dry_run' },
      testContext(bridge),
    )) as { request: { data: Record<string, unknown> } };
    expect(result.request.data).toEqual({ first_name: 'A', last_name: 'B', invite: false });
  });

  it('every write tool has mode and confirm_token', () => {
    for (const write of ALL_TOOLS.filter((t) => t.write)) {
      expect(write.input).toHaveProperty('mode');
      expect(write.input).toHaveProperty('confirm_token');
    }
  });
});

describe('calendar_agenda', () => {
  it('splits a long range, reads in sequence and merges', async () => {
    const bridge = new FakeBridge((call) => {
      const params = call.type === 'call' ? call.request.params : undefined;
      return {
        ok: true,
        data: {
          bookings: [
            { id: 1, appointment_uid: 'SHARED', status: 'A', booked_from: '2026-01-05T10:00', staffer_id: 5 },
            { id: `${params?.start_date}`, appointment_uid: `${params?.start_date}`, status: 'W', booked_from: `${params?.start_date}T10:00`, staffer_id: 6 },
          ],
        },
      };
    });
    const result = (await tool('calendar_agenda').handler(
      { from: '2026-01-01', to: '2026-03-31' },
      testContext(bridge),
    )) as { windows_read: number; count: number };
    expect(result.windows_read).toBe(3);
    expect(result.count).toBe(4);
    expect(bridge.sent().map((c) => (c as unknown as { request: { params: { end_date: string } } }).request.params.end_date)).toEqual([
      '2026-01-31',
      '2026-03-03',
      '2026-03-31',
    ]);
  });

  it('filters by staff and status', async () => {
    const bridge = new FakeBridge(() => ({
      ok: true,
      data: {
        bookings: [
          { id: 1, appointment_uid: 'A', status: 'A', booked_from: '2026-01-05T10:00', staffer_id: 5 },
          { id: 2, appointment_uid: 'B', status: 'W', booked_from: '2026-01-05T11:00', staffer_id: 6 },
        ],
      },
    }));
    const result = (await tool('calendar_agenda').handler(
      { from: '2026-01-05', to: '2026-01-05', staff_id: '6', status: ['W'] },
      testContext(bridge),
    )) as { bookings: Array<{ id: number }> };
    expect(result.bookings.map((b) => b.id)).toEqual([2]);
  });
});

describe('staff_schedule', () => {
  it('joins weeks and trims to the range', async () => {
    const bridge = new FakeBridge((call) => {
      const week = (call as unknown as { request: { params: { week_start_date: string } } }).request.params.week_start_date;
      return {
        ok: true,
        data: {
          schedule: {
            business: { schedule: [{ date: week }] },
            resources: [{ id: 5, schedule: [{ date: week, hours: [] }] }],
          },
        },
      };
    });
    const result = (await tool('staff_schedule').handler(
      { from: '2026-11-02', to: '2026-11-09' },
      testContext(bridge),
    )) as { resources: Array<{ schedule: unknown[] }> };
    expect(bridge.sent()).toHaveLength(2);
    expect(result.resources[0]?.schedule).toHaveLength(2);
  });
});

describe('appointment_changes_feed', () => {
  it('stores a baseline first and reports changes next', async () => {
    let bookings = [{ appointment_uid: 'A', status: 'A', booked_from: '2026-11-03T10:00', staffer_id: 5 }];
    const bridge = new FakeBridge(() => ({ ok: true, data: { bookings } }));
    const context = testContext(bridge);
    const first = (await tool('appointment_changes_feed').handler({ days_back: 0, days_ahead: 7 }, context)) as { baseline: boolean };
    expect(first.baseline).toBe(true);

    bookings = [
      { appointment_uid: 'A', status: 'A', booked_from: '2026-11-03T11:00', staffer_id: 5 },
      { appointment_uid: 'B', status: 'A', booked_from: '2026-11-04T11:00', staffer_id: 5 },
    ];
    const second = (await tool('appointment_changes_feed').handler({ days_back: 0, days_ahead: 7 }, context)) as {
      changes: { new: Array<{ uid: string }>; moved: Array<{ uid: string }> };
    };
    expect(second.changes.new.map((c) => c.uid)).toEqual(['B']);
    expect(second.changes.moved.map((c) => c.uid)).toEqual(['A']);
  });
});

describe('report_export', () => {
  const download = () => ({
    ok: true,
    base64: Buffer.from(sampleWorkbook()).toString('base64'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: 'raport.xlsx',
  });
  const args = {
    report_key: 'sample_report',
    date_from: '2026-10-01',
    date_till: '2026-10-31',
    time_span: 'month',
    max_rows: 10,
  };

  it('saves the file exactly as it came', async () => {
    const context = testContext(new FakeBridge(download));
    const result = (await tool('report_export').handler({ ...args, output: 'file' }, context)) as { file: string };
    expect(existsSync(result.file)).toBe(true);
    expect(readWorkbook(readFileSync(result.file))[0]?.name).toBe('Lista & wizyt');
  });

  it('returns rows as JSON on request', async () => {
    const context = testContext(new FakeBridge(download));
    const result = (await tool('report_export').handler({ ...args, output: 'json' }, context)) as {
      sheets: Array<{ rows: Array<Record<string, string>> }>;
    };
    expect(result.sheets[0]?.rows[0]).toMatchObject({ Klient: 'Sample <Client>' });
  });

  it('converts to CSV next to the file', async () => {
    const context = testContext(new FakeBridge(download));
    const result = (await tool('report_export').handler({ ...args, output: 'csv' }, context)) as { csv_files: string[] };
    expect(readFileSync(result.csv_files[0] as string, 'utf8')).toContain('Data,Klient,Kwota');
  });

  it('keeps the file when it cannot be parsed', async () => {
    const context = testContext(
      new FakeBridge(() => ({ ok: true, base64: Buffer.from('plain').toString('base64') })),
    );
    const result = (await tool('report_export').handler({ ...args, output: 'json' }, context)) as { parse_error: string };
    expect(result.parse_error).toContain('saved');
  });

  it('batch runs in order and survives one bad report', async () => {
    const bridge = new FakeBridge((call) => {
      const key = (call as unknown as { request: { params: { report_key: string } } }).request.params.report_key;
      return key === 'bad' ? { ok: false, status: 400, data: {} } : download();
    });
    const result = (await tool('report_export_batch').handler(
      { ...args, report_keys: ['one', 'bad', 'two'], output: 'file' },
      testContext(bridge),
    )) as { results: Array<{ report_key: string; error?: string }> };
    expect(result.results.map((r) => r.report_key)).toEqual(['one', 'bad', 'two']);
    expect(result.results[1]?.error).toBeTruthy();
  });

  it('batch stops at a block', async () => {
    const bridge = new FakeBridge(() => ({ ok: false, status: 429 }));
    await expect(
      tool('report_export_batch').handler(
        { ...args, report_keys: ['one', 'two'], output: 'file' },
        testContext(bridge),
      ),
    ).rejects.toBeInstanceOf(BooksyError);
    expect(bridge.sent()).toHaveLength(1);
  });
});

describe('stats_report_catalog', () => {
  it('collects keys from the sections and notes the ones the plan lacks', async () => {
    const bridge = new FakeBridge((call) => {
      const dashboard = (call as unknown as { request: { params: { dashboard: string } } }).request.params.dashboard;
      if (dashboard === 'inventory') return { ok: false, status: 404, data: {} };
      return { ok: true, data: { reports: [{ key: `${dashboard}_list`, title: 'T' }] } };
    });
    const result = (await tool('stats_report_catalog').handler(
      { date_from: '2026-10-01', date_till: '2026-10-31', time_span: 'month' },
      testContext(bridge),
    )) as { count: number; unavailable: Array<{ dashboard: string }> };
    expect(result.count).toBe(7);
    expect(result.unavailable.map((u) => u.dashboard)).toEqual(['inventory']);
  });

  it('a 403 ends the reading and keeps what was found', async () => {
    const bridge = new FakeBridge((call) => {
      const dashboard = (call as unknown as { request: { params: { dashboard: string } } }).request.params.dashboard;
      if (dashboard === 'clients') return { ok: false, status: 403, data: {} };
      return { ok: true, data: { reports: [{ key: `${dashboard}_list`, title: 'T' }] } };
    });
    const result = (await tool('stats_report_catalog').handler(
      { date_from: '2026-10-01', date_till: '2026-10-31', time_span: 'month' },
      testContext(bridge),
    )) as { count: number; stopped_early: string };
    expect(result.count).toBe(1);
    expect(result.stopped_early).toContain('403');
    expect(bridge.sent()).toHaveLength(2);
  });
});

describe('session_status', () => {
  it('shows the pairing code when not connected', async () => {
    const bridge = new FakeBridge();
    const status = { ...bridge.status(), connected: false, paired: false, pairingCode: 'ABCD2345' };
    const context = testContext(bridge, { bridgeStatus: () => status });
    const result = (await tool('session_status').handler({}, context)) as { next: string };
    expect(result.next).toContain('ABCD2345');
    expect(bridge.calls).toHaveLength(0);
  });

  it('shows the salon when connected', async () => {
    const result = (await tool('session_status').handler({}, testContext(new FakeBridge()))) as {
      panel: { businessName: string };
    };
    expect(result.panel.businessName).toBe('Sample Barbers');
  });
});

describe('session_status traffic', () => {
  it('shows the mode, the use of budgets and a cooldown', async () => {
    const bridge = new FakeBridge(() => ({ ok: false, status: 429 }));
    const gateway = new Gateway(bridge, {
      traffic: SAFE_TRAFFIC,
      maskContacts: false,
      sleep: async () => undefined,
    });
    await expect(gateway.request('reviews.list')).rejects.toBeTruthy();
    const context = testContext(bridge, { gateway });
    const result = (await tool('session_status').handler({}, context)) as {
      traffic: { mode: string; requests_this_hour: { used: number }; cooldown: { active: boolean } };
      next: string;
    };
    expect(result.traffic).toMatchObject({
      mode: 'safe',
      requests_this_hour: { used: 1 },
      cooldown: { active: true },
    });
    expect(result.next).toContain('do not work around it');
  });
});

describe('safe mode in tools', () => {
  function safeContext(bridge: FakeBridge, traffic: Partial<TrafficPolicy> = {}) {
    const pauses: number[] = [];
    const gateway = new Gateway(bridge, {
      traffic: { ...SAFE_TRAFFIC, minIntervalMs: 0, ...traffic },
      maskContacts: false,
      random: () => 0,
      sleep: async (ms) => {
        pauses.push(ms);
      },
    });
    return { context: testContext(bridge, { gateway }), pauses };
  }

  it('reads a calendar range in short windows with pauses', async () => {
    const bridge = new FakeBridge(() => ({ ok: true, data: { bookings: [] } }));
    const { context, pauses } = safeContext(bridge);
    const result = (await tool('calendar_agenda').handler(
      { from: '2026-11-01', to: '2026-11-30' },
      context,
    )) as { windows_read: number };
    expect(result.windows_read).toBe(3);
    expect(bridge.sent()).toHaveLength(3);
    expect(pauses).toEqual([SAFE_TRAFFIC.windowPauseMs, SAFE_TRAFFIC.windowPauseMs]);
  });

  it('refuses a range over the limit without sending anything', async () => {
    const bridge = new FakeBridge();
    const { context } = safeContext(bridge);
    await expect(
      tool('calendar_agenda').handler({ from: '2026-01-01', to: '2026-12-31' }, context),
    ).rejects.toMatchObject({ code: 'safe_mode_limit' });
    await expect(
      tool('staff_schedule').handler({ from: '2026-01-01', to: '2026-12-31' }, context),
    ).rejects.toMatchObject({ code: 'safe_mode_limit' });
    expect(bridge.sent()).toHaveLength(0);
  });

  it.each(['stats_report', 'stats_overview', 'stats_dashboard', 'stats_report_catalog', 'report_export'])(
    '%s refuses a report period over the limit',
    async (name) => {
      const bridge = new FakeBridge();
      const { context } = safeContext(bridge);
      await expect(
        tool(name).handler(
          {
            report_key: 'a',
            dashboard: 'staff',
            date_from: '2024-01-01',
            date_till: '2026-01-01',
            time_span: 'between',
            output: 'file',
          },
          context,
        ),
      ).rejects.toMatchObject({ code: 'safe_mode_limit' });
      expect(bridge.sent()).toHaveLength(0);
    },
  );

  it('refuses a batch that is too big', async () => {
    const bridge = new FakeBridge();
    const { context } = safeContext(bridge);
    await expect(
      tool('report_export_batch').handler(
        {
          report_keys: ['a', 'b', 'c', 'd', 'e', 'f'],
          date_from: '2026-10-01',
          date_till: '2026-10-31',
          time_span: 'month',
          output: 'file',
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'safe_mode_limit' });
    expect(bridge.sent()).toHaveLength(0);
  });

  it('a batch stopped by a limit still lists what it saved', async () => {
    const bridge = new FakeBridge(() => ({ ok: true, base64: 'AQID', contentType: 'text/csv' }));
    const { context } = safeContext(bridge, { maxExportsPerDay: 1 });
    const result = (await tool('report_export_batch').handler(
      {
        report_keys: ['a', 'b'],
        date_from: '2026-10-01',
        date_till: '2026-10-31',
        time_span: 'month',
        output: 'file',
      },
      context,
    )) as { results: unknown[]; stopped_early: string };
    expect(result.results).toHaveLength(1);
    expect(result.stopped_early).toMatch(/report exports/);
  });
});

describe('parameters seen in the live panel', () => {
  it('calendar_month names every resource, like the panel', async () => {
    const bridge = new FakeBridge(() => ({ ok: true, data: { resources: [{ id: 7 }, { id: 8 }] } }));
    await tool('calendar_month').handler(
      { start_date: '2026-11-01', end_date: '2026-11-30' },
      testContext(bridge),
    );
    expect(bridge.sent()[1]).toMatchObject({
      request: {
        ruleId: 'calendar.month',
        params: {
          start_date: '2026-11-01',
          end_date: '2026-11-30',
          include_unconfirmed: true,
          version: 3,
          resources_per_page: 100,
          resource_id: ['7', '8'],
        },
      },
    });
  });

  it('calendar_month takes a chosen resource without reading the list', async () => {
    const bridge = new FakeBridge();
    await tool('calendar_month').handler(
      { start_date: '2026-11-01', end_date: '2026-11-30', resource_ids: ['7'] },
      testContext(bridge),
    );
    expect(bridge.sent()).toHaveLength(1);
    expect(bridge.sent()[0]).toMatchObject({ request: { params: { resource_id: ['7'] } } });
  });

  it('customer_visit_history sends the panel spelling', async () => {
    const bridge = new FakeBridge();
    await tool('customer_visit_history').handler(
      { customerId: '5', page: 1, per_page: 20, state: 'finished', include_extra_bookings: true },
      testContext(bridge),
    );
    expect(bridge.sent()[0]).toMatchObject({
      request: {
        ruleId: 'customers.bookings',
        params: { page: 1, per_page: 20, state: 'finished', inlcude_extra_bookings: true },
      },
    });
  });
});

describe('stats_frame_requests', () => {
  it('returns what the frame asked for and sends nothing to Booksy', async () => {
    const frames = [{ host: 'stats-and-reports.booksy.com', requests: [] }];
    const bridge = new FakeBridge(() => ({ ok: true, data: frames }));
    const context = testContext(bridge);
    const result = (await tool('stats_frame_requests').handler({}, context)) as {
      frames: unknown[];
    };
    expect(result.frames).toEqual(frames);
    expect(bridge.calls.map((call) => call.type)).toEqual(['frames']);
    expect(context.gateway.status().requests_this_hour.used).toBe(0);
  });
});

describe('team_resources', () => {
  it('separates staff from stations', async () => {
    const bridge = new FakeBridge(() => ({
      ok: true,
      data: { resources: [{ id: 1, type: 'S' }, { id: 2, type: 'R' }] },
    }));
    const result = (await tool('team_resources').handler({ kind: 'station' }, testContext(bridge))) as {
      resources: Array<{ id: number }>;
    };
    expect(result.resources.map((r) => r.id)).toEqual([2]);
  });
});

describe('large results', () => {
  it('go to a file with a preview', () => {
    const config = testConfig({ maxResultChars: 100 });
    const result = toToolResult({ data: 'x'.repeat(500) }, config, new Date('2026-11-02T10:00:00Z'));
    const body = JSON.parse((result.content[0] as { text: string }).text) as {
      truncated: boolean;
      full_result_file: string;
    };
    expect(body.truncated).toBe(true);
    expect(JSON.parse(readFileSync(body.full_result_file, 'utf8')).data).toHaveLength(500);
  });
});
