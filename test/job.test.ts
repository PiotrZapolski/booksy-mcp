import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BridgeCall } from '../src/bridge/server.js';
import { SAFE_TRAFFIC, UNRESTRICTED_TRAFFIC } from '../src/config.js';
import { dayMinutes } from '../src/domain/slots.js';
import { BooksyError } from '../src/errors.js';
import { Gateway } from '../src/gateway/gateway.js';
import { TrafficLedger } from '../src/gateway/ledger.js';
import {
  exitCodeFor,
  fillPhones,
  type JobOptions,
  type JobSchedule,
  parseJobArgs,
  runAgenda,
  readKnownCustomers,
  runJob,
  timeSpanFor,
} from '../src/job.js';
import { phoneFromDetails } from '../src/domain/agenda.js';
import type { PanelResult } from '../src/shared/protocol.js';
import { FakeBridge, tempDir } from './helpers.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function shiftsAnswer(week: string): PanelResult {
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
    date: new Date(Date.parse(`${week}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10),
    hours: offset < 5 ? [{ hour_from: '10:00', hour_till: '18:00' }] : [],
    time_offs: offset === 1 ? [{ hour_from: '12:00', hour_till: '13:00' }] : [],
  }));
  return {
    ok: true,
    data: {
      schedule: {
        business: { schedule: days },
        resources: [{ resource: { id: 7, name: 'Staff A', type: 'S' }, schedule: days }],
      },
    },
  };
}

type Answer = (call: BridgeCall) => PanelResult | undefined;

function setup(answer: Answer = () => undefined, traffic = UNRESTRICTED_TRAFFIC) {
  const bridge = new FakeBridge((call) => {
    const custom = answer(call);
    if (custom) return custom;
    if (call.type === 'open_panel') return { ok: true, data: { tabId: 42, opened: true } };
    if (call.type === 'close_panel') return { ok: true, data: { closed: true } };
    if (call.type !== 'call') return { ok: true, data: {} };
    if (call.request.ruleId === 'shifts.week') {
      return shiftsAnswer(String(call.request.params?.week_start_date));
    }
    const key = String(call.request.params?.report_key);
    return {
      ok: true,
      base64: Buffer.from(`file of ${key}`).toString('base64'),
      contentType: XLSX,
      filename: `${key}.xlsx`,
    };
  });
  const waits: number[] = [];
  const gateway = new Gateway(bridge, {
    traffic,
    redactPii: false,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { bridge, gateway, waits };
}

function options(overrides: Partial<JobOptions> = {}): JobOptions {
  const out = tempDir();
  return {
    exports: [
      { reportKey: 'appointments_list', from: '2026-11-01', to: '2026-11-30', timeSpan: 'month' },
      { reportKey: 'sales_log', from: '2026-11-01', to: '2026-11-30', timeSpan: 'month' },
    ],
    out,
    schedule: { from: '2026-11-01', to: '2026-12-31' },
    scheduleOut: join(out, 'schedule.json'),
    summaryOut: join(out, 'summary.json'),
    openPanel: false,
    jitterSeconds: 0,
    agenda: null,
    ...overrides,
  };
}

describe('job arguments', () => {
  it('reads a full scheduled run', () => {
    const parsed = parseJobArgs([
      '--exports',
      'appointments_list,clients_list',
      '--from',
      '2026-11-01',
      '--to',
      '2026-11-30',
      '--export',
      'sales_log:2026-10-01:2026-10-31',
      '--out',
      '/tmp/out',
      '--schedule',
      '2026-11-01',
      '2026-12-31',
      '--open-panel',
      '--jitter',
      '900',
    ]);
    expect(parsed).toMatchObject({
      exports: [
        { reportKey: 'appointments_list', from: '2026-11-01', to: '2026-11-30', timeSpan: 'month' },
        { reportKey: 'clients_list', timeSpan: 'month' },
        { reportKey: 'sales_log', from: '2026-10-01', to: '2026-10-31', timeSpan: 'month' },
      ],
      out: '/tmp/out',
      schedule: { from: '2026-11-01', to: '2026-12-31' },
      scheduleOut: '/tmp/out/schedule.json',
      summaryOut: '/tmp/out/summary.json',
      openPanel: true,
      jitterSeconds: 900,
    });
  });

  it('refuses wrong input before anything runs', () => {
    expect(parseJobArgs(['--exports', 'a'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x', '--exports', 'a'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x', '--export', 'a:2026-11-01'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x', '--export', 'a/b:2026-11-01:2026-11-02'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x', '--export', 'a:2026-11-31:2026-12-01'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x', '--schedule', '2026-11-01'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x', '--schedule', '2026-11-01', '2026-11-02', '--jitter', '-1'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', 'x', '--schedule', '2026-11-01', '2026-11-02', '--scheduled'])).toHaveProperty('error');
  });

  it('sends month for a whole month and between otherwise', () => {
    expect(timeSpanFor('2026-11-01', '2026-11-30')).toBe('month');
    expect(timeSpanFor('2026-02-01', '2026-02-28')).toBe('month');
    expect(timeSpanFor('2026-11-01', '2026-11-03')).toBe('between');
    expect(timeSpanFor('2026-10-01', '2026-11-30')).toBe('between');
  });
});

describe('job run', () => {
  it('saves every report and the schedule, and exits 0', async () => {
    const { bridge, gateway } = setup();
    const job = options();
    const summary = await runJob(job, { gateway });

    expect(summary).toMatchObject({ exit_code: 0, status: 'complete', error_code: null });
    expect(summary.panel).toEqual({ business_id: '1001', business_name: 'Sample Barbers' });
    const file = join(job.out, 'appointments_list_2026-11-01_2026-11-30.xlsx');
    expect(summary.exports[0]).toMatchObject({ ok: true, file });
    expect(readFileSync(file, 'utf8')).toBe('file of appointments_list');
    expect(JSON.parse(readFileSync(job.summaryOut, 'utf8'))).toEqual(summary);

    const downloads = bridge.sent().filter(
      (call) => call.type === 'call' && call.request.ruleId === 'stats.download',
    );
    expect(downloads).toHaveLength(2);
    expect(downloads[0]).toMatchObject({
      request: {
        params: {
          report_key: 'appointments_list',
          date_from: '2026-11-01',
          date_till: '2026-11-30',
          time_span: 'month',
        },
      },
    });
    expect(bridge.sent().some((call) => call.type === 'open_panel')).toBe(false);
  });

  it('writes minutes per staff member and day, with zero for days off', async () => {
    const { gateway } = setup();
    const job = options({ exports: [] });
    await runJob(job, { gateway });
    const schedule = JSON.parse(readFileSync(job.scheduleOut, 'utf8')) as JobSchedule;
    const staff = schedule.staff[0];
    expect(staff).toMatchObject({ id: '7', name: 'Staff A', type: 'S' });
    expect(Object.keys(staff?.days ?? {})).toHaveLength(61);
    expect(staff?.days['2026-11-02']).toMatchObject({ minutes: 480, scheduled_minutes: 480 });
    expect(staff?.days['2026-11-03']).toMatchObject({ minutes: 420, time_off_minutes: 60 });
    expect(staff?.days['2026-11-01']?.minutes).toBe(0);
    expect(staff?.month_minutes['2026-11']).toBeGreaterThan(0);
  });

  it('goes on after a report Booksy cannot build, and exits 1', async () => {
    const { gateway } = setup((call) =>
      call.type === 'call' && call.request.params?.report_key === 'appointments_list'
        ? { ok: false, status: 500, data: {} }
        : undefined,
    );
    const summary = await runJob(options(), { gateway });
    expect(summary.exit_code).toBe(1);
    expect(summary.exports[0]).toMatchObject({ ok: false, error_code: 'booksy_error' });
    expect(summary.exports[1]).toMatchObject({ ok: true });
  });

  it('stops at a 429, skips the rest and exits 4', async () => {
    const { bridge, gateway } = setup((call) =>
      call.type === 'call' && call.request.params?.report_key === 'appointments_list'
        ? { ok: false, status: 429, data: {} }
        : undefined,
    );
    const summary = await runJob(options(), { gateway });
    expect(summary).toMatchObject({ exit_code: 4, status: 'blocked', error_code: 'blocked_by_booksy' });
    expect(summary.schedule?.ok).toBe(true);
    expect(summary.exports[1]).toMatchObject({ ok: false, error_code: 'skipped' });
    const downloads = bridge.sent().filter(
      (call) => call.type === 'call' && call.request.ruleId === 'stats.download',
    );
    expect(downloads).toHaveLength(1);
  });

  it('sends nothing during a cooldown and exits 4', async () => {
    const dir = tempDir();
    const ledger = new TrafficLedger(join(dir, 'traffic.json'));
    ledger.block(Date.now() + 60_000, 'a 429 answer from Booksy');
    const { bridge } = setup();
    const gateway = new Gateway(bridge, {
      traffic: SAFE_TRAFFIC,
      redactPii: false,
      ledgerPath: join(dir, 'traffic.json'),
      sleep: async () => undefined,
    });
    const summary = await runJob(options(), { gateway });
    expect(summary.exit_code).toBe(4);
    expect(bridge.sent()).toHaveLength(0);
  });

  it('exits 3 when the extension is not there', async () => {
    const { bridge, gateway } = setup();
    bridge.call = async () => {
      throw new BooksyError('bridge_not_connected', 'not connected');
    };
    const summary = await runJob(options(), { gateway });
    expect(summary).toMatchObject({ exit_code: 3, status: 'no_panel', error_code: 'bridge_not_connected' });
    expect(summary.exports.every((entry) => entry.error_code === 'skipped')).toBe(true);
  });

  it('exits 3 when no panel tab is open', async () => {
    const { bridge, gateway } = setup();
    const call = bridge.call.bind(bridge);
    bridge.call = async (message) =>
      message.type === 'context' ? { ok: false, failure: 'tab_missing' } : call(message);
    const summary = await runJob(options(), { gateway });
    expect(summary).toMatchObject({ exit_code: 3, error_code: 'panel_tab_missing' });
  });

  it('opens a background tab only when asked, and closes it at the end', async () => {
    const { bridge, gateway } = setup();
    const summary = await runJob(options({ openPanel: true }), { gateway });
    expect(summary.opened_tab).toBe(true);
    const types = bridge.calls.map((call) => call.type);
    expect(types[0]).toBe('open_panel');
    expect(types.at(-1)).toBe('close_panel');
    expect(bridge.calls.at(-1)).toEqual({ type: 'close_panel', tabId: 42 });
  });

  it('leaves a tab it did not open', async () => {
    const { bridge, gateway } = setup((call) =>
      call.type === 'open_panel' ? { ok: true, data: { tabId: 5, opened: false } } : undefined,
    );
    const summary = await runJob(options({ openPanel: true }), { gateway });
    expect(summary.opened_tab).toBe(false);
    expect(bridge.calls.some((call) => call.type === 'close_panel')).toBe(false);
  });

  it('closes its tab also after a block', async () => {
    const { bridge, gateway } = setup((call) =>
      call.type === 'call' ? { ok: false, status: 403, data: {} } : undefined,
    );
    const summary = await runJob(options({ openPanel: true }), { gateway });
    expect(summary.exit_code).toBe(4);
    expect(bridge.calls.at(-1)).toEqual({ type: 'close_panel', tabId: 42 });
  });

  it('waits a random time before the first request', async () => {
    const { bridge, gateway } = setup();
    const sleeps: number[] = [];
    let callsAtWake = -1;
    const summary = await runJob(options({ jitterSeconds: 900 }), {
      gateway,
      random: () => 0.5,
      sleep: async (ms) => {
        callsAtWake = bridge.calls.length;
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([450_000]);
    expect(callsAtWake).toBe(0);
    expect(summary.jitter_seconds).toBe(450);
  });

  it('keeps the gaps of safe mode between exports', async () => {
    const { gateway, waits } = setup(undefined, SAFE_TRAFFIC);
    await runJob(options({ schedule: null }), { gateway });
    expect(waits.some((ms) => ms >= SAFE_TRAFFIC.exportIntervalMs)).toBe(true);
  });

  it('refuses a report period longer than safe mode allows', async () => {
    const { gateway } = setup(undefined, SAFE_TRAFFIC);
    const summary = await runJob(
      options({
        schedule: null,
        exports: [{ reportKey: 'clients_list', from: '2024-01-01', to: '2026-11-30', timeSpan: 'between' }],
      }),
      { gateway },
    );
    expect(summary.exit_code).toBe(2);
    expect(summary.exports[0]?.error_code).toBe('safe_mode_limit');
  });

  it('does not write a schedule file when the schedule fails', async () => {
    const { gateway } = setup((call) =>
      call.type === 'call' && call.request.ruleId === 'shifts.week'
        ? { ok: false, status: 500, data: {} }
        : undefined,
    );
    const job = options();
    const summary = await runJob(job, { gateway });
    expect(summary.exit_code).toBe(1);
    expect(existsSync(job.scheduleOut)).toBe(false);
  });
});

describe('exit codes', () => {
  it('ranks a block above everything and a missing panel only when nothing was saved', () => {
    const block = { kind: 'block' as const, code: 'blocked_by_booksy', message: '' };
    const bridge = { kind: 'bridge' as const, code: 'bridge_not_connected', message: '' };
    expect(exitCodeFor(3, 3, null)).toBe(0);
    expect(exitCodeFor(2, 3, block)).toBe(4);
    expect(exitCodeFor(1, 3, bridge)).toBe(1);
    expect(exitCodeFor(0, 3, bridge)).toBe(3);
    expect(exitCodeFor(0, 3, null)).toBe(2);
  });
});

describe('day minutes', () => {
  it('takes time off out of the shifts only where they overlap', () => {
    expect(
      dayMinutes({
        hours: [{ hour_from: '10:00', hour_till: '14:00' }, { hour_from: '15:00', hour_till: '19:00' }],
        time_offs: [{ hour_from: '13:00', hour_till: '16:00' }],
      }),
    ).toEqual({ scheduled: 480, timeOff: 120, work: 360 });
    expect(
      dayMinutes({ hours: [{ hour_from: '10:00', hour_till: '18:00' }], time_offs: [{ all_day: true }] }),
    ).toEqual({ scheduled: 480, timeOff: 480, work: 0 });
    expect(dayMinutes(undefined)).toEqual({ scheduled: 0, timeOff: 0, work: 0 });
  });
});

describe('open panel', () => {
  it('explains an extension that does not know the request', async () => {
    const { bridge, gateway } = setup();
    bridge.call = async () => {
      throw new BooksyError('bridge_timeout', 'late');
    };
    await expect(gateway.openPanel()).rejects.toMatchObject({ code: 'extension_outdated' });
  });

  it('waits for the panel in the new tab to load', async () => {
    const { bridge, gateway } = setup();
    let loading = 2;
    const call = bridge.call.bind(bridge);
    bridge.call = async (message) => {
      if (message.type === 'context' && loading > 0) {
        loading -= 1;
        return { ok: false, failure: 'panel_not_ready' };
      }
      return call(message);
    };
    await expect(gateway.openPanel()).resolves.toEqual({ tabId: 42, opened: true });
    expect(loading).toBe(0);
  });

  it('waits while a fresh tab has not loaded the signed-in user yet', async () => {
    const { bridge, gateway } = setup();
    let loading = 2;
    const call = bridge.call.bind(bridge);
    bridge.call = async (message) => {
      if (message.type === 'context' && loading > 0) {
        loading -= 1;
        return { ok: false, failure: 'not_logged_in' };
      }
      return call(message);
    };
    await expect(gateway.openPanel()).resolves.toEqual({ tabId: 42, opened: true });
    expect(loading).toBe(0);
  });
});

describe('shared ledger', () => {
  it('lets a job and a server count into the same file', () => {
    const path = join(tempDir(), 'traffic.json');
    const server = new TrafficLedger(path);
    const job = new TrafficLedger(path);
    server.record('requests');
    job.record('requests', 2);
    server.record('exports');
    expect(server.count('requests', 60_000)).toBe(3);
    expect(job.count('exports', 60_000)).toBe(1);
  });
});

function calendarAnswer(): PanelResult {
  return {
    ok: true,
    data: {
      bookings: {
        '501': {
          appointment_uid: 9001,
          status: 'A',
          updated_epoch: 1795400000,
          booked_from: '2026-11-23 10:00:00',
          booked_till: '2026-11-23 11:00:00',
          service: { name: 'Strzyzenie wlosow' },
          resources: [{ id: 7 }],
          customer: { id: 987, name: 'Jan Kowalski', phone: '+48 600 000 000' },
        },
      },
      reservations: {},
      resources: [{ id: 7, name: 'Bartek', time_offs: {} }],
    },
  };
}

function agendaSetup(answer: Answer = () => undefined) {
  return setup((call) => {
    const custom = answer(call);
    if (custom) return custom;
    if (call.type === 'call' && call.request.ruleId === 'calendar.range') return calendarAnswer();
    return undefined;
  }, SAFE_TRAFFIC);
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('agenda job', () => {
  it('reads --agenda with a range and needs no --out', () => {
    expect(
      parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-29', '--open-panel', '--jitter', '300']),
    ).toMatchObject({
      agenda: { from: '2026-11-23', to: '2026-11-29' },
      exports: [],
      schedule: null,
      openPanel: true,
      jitterSeconds: 300,
    });
    expect(parseJobArgs(['--agenda'])).toHaveProperty('error');
    expect(parseJobArgs(['--agenda', '--from', '2026-11-24', '--to', '2026-11-23'])).toHaveProperty('error');
    expect(
      parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-24', '--exports', 'a']),
    ).toHaveProperty('error');
    expect(
      parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-24', '--schedule', '2026-11-23', '2026-11-24']),
    ).toHaveProperty('error');
  });

  it('makes one calendar request and prints the contract, writing no files', async () => {
    const dir = tempDir();
    const { bridge } = agendaSetup();
    const gateway = new Gateway(bridge, {
      traffic: SAFE_TRAFFIC,
      redactPii: false,
      ledgerPath: join(dir, 'traffic.json'),
      sleep: async () => undefined,
    });
    const job = options({ out: join(dir, 'out'), exports: [], schedule: null, agenda: { from: '2026-11-23', to: '2026-11-24' } });
    const outcome = await runAgenda(job, { gateway, now: () => new Date('2026-11-23T06:31:12Z') });

    expect(outcome).toMatchObject({ exit_code: 0, error_code: null });
    const calls = bridge.sent().filter((call) => call.type === 'call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      request: { ruleId: 'calendar.range', params: { start_date: '2026-11-23', end_date: '2026-11-24' } },
    });
    const parsed = JSON.parse(JSON.stringify(outcome.payload));
    expect(parsed).toEqual({
      status: 'ok',
      reason: null,
      range_from: '2026-11-23',
      range_to: '2026-11-24',
      complete: true,
      fetched_at: '2026-11-23T07:31:12+01:00',
      visits: [
        {
          visit_id: 9001,
          start: '2026-11-23T10:00',
          end: '2026-11-23T11:00',
          status: 'A',
          updated_epoch: 1795400000,
          service: 'Strzyzenie wlosow',
          staff: ['Bartek'],
          customer_id: 987,
          customer_name: 'Jan Kowalski',
          phone: '+48 600 000 000',
        },
      ],
    });
    for (const file of filesUnder(dir)) {
      expect(readFileSync(file, 'utf8')).not.toContain('600 000 000');
      expect(readFileSync(file, 'utf8')).not.toContain('Kowalski');
    }
    expect(existsSync(job.summaryOut)).toBe(false);
  });

  it('stops at a 429 without a retry and exits 4', async () => {
    const { bridge, gateway } = agendaSetup((call) =>
      call.type === 'call' ? { ok: false, status: 429, data: {} } : undefined,
    );
    const job = options({ exports: [], schedule: null, agenda: { from: '2026-11-23', to: '2026-11-24' } });
    const outcome = await runAgenda(job, { gateway });
    expect(outcome).toMatchObject({ exit_code: 4, error_code: 'blocked_by_booksy', payload: null });
    expect(bridge.sent().filter((call) => call.type === 'call')).toHaveLength(1);
  });

  it('exits 3 when the panel is logged out', async () => {
    const { bridge, gateway } = agendaSetup();
    const call = bridge.call.bind(bridge);
    bridge.call = async (message) =>
      message.type === 'context' ? { ok: false, failure: 'not_logged_in' } : call(message);
    const job = options({ exports: [], schedule: null, agenda: { from: '2026-11-23', to: '2026-11-24' } });
    const outcome = await runAgenda(job, { gateway });
    expect(outcome).toMatchObject({ exit_code: 3, error_code: 'not_logged_in', payload: null });
    expect(bridge.sent().filter((sent) => sent.type === 'call')).toHaveLength(0);
  });

  it('closes the tab it opened, also after a block', async () => {
    const { bridge, gateway } = agendaSetup((call) =>
      call.type === 'call' ? { ok: false, status: 429, data: {} } : undefined,
    );
    const job = options({
      exports: [],
      schedule: null,
      openPanel: true,
      agenda: { from: '2026-11-23', to: '2026-11-24' },
    });
    const outcome = await runAgenda(job, { gateway });
    expect(outcome.exit_code).toBe(4);
    expect(bridge.sent().some((sent) => sent.type === 'close_panel')).toBe(true);
  });
});

function appBooking(uid: number, customerId: number, from: string, phone: string | null = null) {
  return {
    appointment_uid: uid,
    status: 'A',
    booked_from: `2026-11-23 ${from}:00`,
    booked_till: `2026-11-23 ${from.slice(0, 2)}:45:00`,
    service: { name: 'Broda' },
    resources: [{ id: 7 }],
    customer: { id: customerId, name: `Klient ${customerId}`, phone },
  };
}

function appCalendar(): PanelResult {
  return {
    ok: true,
    data: {
      bookings: {
        '1': appBooking(9001, 987, '09:00', '+48 600 000 000'),
        '2': appBooking(9002, 988, '10:00'),
        '3': appBooking(9003, 989, '11:00'),
        '4': appBooking(9004, 988, '12:00'),
        '5': appBooking(9005, 990, '13:00', '  '),
        '6': { ...appBooking(9006, 0, '14:00'), customer: { name: 'Bez karty' } },
      },
      reservations: {},
      resources: [{ id: 7, name: 'Bartek', time_offs: {} }],
    },
  };
}

function details(uid: string): PanelResult {
  const phones: Record<string, unknown> = {
    '9002': { merged_data: { cell_phone: '+48 511 111 111' }, customer_profile: { cell_phone: '+48 522' }, business_customer: { cell_phone: '' } },
    '9003': { merged_data: {}, customer_profile: { cell_phone: '+48 533 333 333' }, business_customer: {} },
    '9005': { merged_data: { cell_phone: null }, business_customer: { cell_phone: '+48 555 555 555' } },
  };
  return { ok: true, data: { appointment: { appointment_uid: Number(uid), customer: phones[uid] ?? {} } } };
}

function phoneSetup(onDetails: (uid: string) => PanelResult = details) {
  return setup((call) => {
    if (call.type !== 'call') return undefined;
    if (call.request.ruleId === 'calendar.range') return appCalendar();
    if (call.request.ruleId === 'appointment.read') {
      return onDetails(String(call.request.urlParams?.appointmentUid));
    }
    return undefined;
  }, SAFE_TRAFFIC);
}

const detailCalls = (bridge: FakeBridge) =>
  bridge
    .sent()
    .filter((call) => call.type === 'call' && call.request.ruleId === 'appointment.read')
    .map((call) => (call.type === 'call' ? call.request.urlParams?.appointmentUid : null));

const agendaJob = (agenda: Partial<NonNullable<JobOptions['agenda']>> = {}) =>
  options({ exports: [], schedule: null, agenda: { from: '2026-11-23', to: '2026-11-23', ...agenda } });

describe('agenda phones from appointment details', () => {
  it('reads --known-customers and --details-limit only with --agenda', () => {
    expect(
      parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-23', '--known-customers', '/tmp/k', '--details-limit', '5']),
    ).toMatchObject({ agenda: { knownCustomersFile: '/tmp/k', detailsLimit: 5 } });
    expect(parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-23'])).toMatchObject({
      agenda: { detailsLimit: 30 },
    });
    expect(parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-23', '--details-limit', '-1'])).toHaveProperty('error');
    expect(parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-23', '--details-limit', '101'])).toHaveProperty('error');
    expect(parseJobArgs(['--agenda', '--from', '2026-11-23', '--to', '2026-11-23', '--known-customers'])).toHaveProperty('error');
    expect(parseJobArgs(['--out', '/tmp/o', '--schedule', '2026-11-01', '2026-11-02', '--details-limit', '3'])).toHaveProperty('error');
  });

  it('picks the phone from merged data, then the profile, then the salon card', () => {
    expect(phoneFromDetails(details('9002').data)).toBe('+48 511 111 111');
    expect(phoneFromDetails(details('9003').data)).toBe('+48 533 333 333');
    expect(phoneFromDetails(details('9005').data)).toBe('+48 555 555 555');
    expect(phoneFromDetails({ customer: { merged_data: { cell_phone: ' +48 1 ' } } })).toBe('+48 1');
    expect(phoneFromDetails({ appointment: { customer: {} } })).toBeNull();
    expect(phoneFromDetails(null)).toBeNull();
  });

  it('reads details once per customer without a phone, skipping known ones, and writes no phones', async () => {
    const dir = tempDir();
    const known = join(dir, 'known.txt');
    writeFileSync(known, '989\n\nnot-an-id\n12\n');
    const { bridge } = phoneSetup();
    const gateway = new Gateway(bridge, {
      traffic: SAFE_TRAFFIC,
      redactPii: false,
      ledgerPath: join(dir, 'traffic.json'),
      sleep: async () => undefined,
    });
    const lines: string[] = [];
    const outcome = await runAgenda(agendaJob({ knownCustomersFile: known, detailsLimit: 30 }), {
      gateway,
      log: (line) => lines.push(line),
    });
    expect(outcome).toMatchObject({ exit_code: 0, error_code: null });
    expect(detailCalls(bridge)).toEqual(['9002', '9005']);
    const phones = Object.fromEntries((outcome.payload?.visits ?? []).map((v) => [v.visit_id, v.phone]));
    expect(phones).toEqual({
      9001: '+48 600 000 000',
      9002: '+48 511 111 111',
      9003: null, // known to the caller
      9004: '+48 511 111 111', // same customer as 9002
      9005: '+48 555 555 555',
      9006: null, // no customer id
    });
    expect(outcome.payload?.complete).toBe(true);
    expect(lines.join('\n')).toContain('2 found in 2 requests');
    for (const file of filesUnder(dir)) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/511 111|555 555|600 000/);
    }
  });

  it('keeps to the limit, earliest visit first', async () => {
    const { bridge, gateway } = phoneSetup();
    await runAgenda(agendaJob({ detailsLimit: 2 }), { gateway });
    expect(detailCalls(bridge)).toEqual(['9002', '9003']);
    const { bridge: none, gateway: noneGateway } = phoneSetup();
    await runAgenda(agendaJob({ detailsLimit: 0 }), { gateway: noneGateway });
    expect(detailCalls(none)).toEqual([]);
  });

  it('stops at a 403 without a retry and still prints the calendar', async () => {
    const { bridge, gateway } = phoneSetup((uid) =>
      uid === '9003' ? { ok: false, status: 403, data: {} } : details(uid),
    );
    const lines: string[] = [];
    const outcome = await runAgenda(agendaJob(), { gateway, log: (line) => lines.push(line) });
    expect(outcome).toMatchObject({ exit_code: 0, payload: { complete: true } });
    expect(detailCalls(bridge)).toEqual(['9002', '9003']);
    expect(outcome.payload?.visits.find((v) => v.visit_id === 9002)?.phone).toBe('+48 511 111 111');
    expect(outcome.payload?.visits.find((v) => v.visit_id === 9005)?.phone).toBeNull();
    expect(lines.join('\n')).toContain('stopped after blocked_by_booksy');
  });

  it('stops at a captcha answer too, and skips one failed visit otherwise', async () => {
    const captcha = phoneSetup(() => ({ ok: false, status: 200, data: { error: 'captcha required' } }));
    const result = await fillPhones(
      captcha.gateway,
      (await runAgenda(agendaJob({ detailsLimit: 0 }), { gateway: captcha.gateway })).payload?.visits ?? [],
      new Set(),
      30,
      () => undefined,
    );
    expect(result).toMatchObject({ read: 1, found: 0, stopped: 'blocked_by_booksy' });

    const missing = phoneSetup((uid) => (uid === '9002' ? { ok: false, status: 404, data: {} } : details(uid)));
    const outcome = await runAgenda(agendaJob(), { gateway: missing.gateway });
    expect(detailCalls(missing.bridge)).toEqual(['9002', '9003', '9005']);
    expect(outcome.payload?.visits.find((v) => v.visit_id === 9003)?.phone).toBe('+48 533 333 333');
  });

  it('treats an unreadable known-customers file as an empty list', () => {
    const lines: string[] = [];
    expect(readKnownCustomers(join(tempDir(), 'nope.txt'), (line) => lines.push(line)).size).toBe(0);
    expect(lines[0]).toContain('ENOENT');
    expect(readKnownCustomers(undefined, () => undefined).size).toBe(0);
  });
});
