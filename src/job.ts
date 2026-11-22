import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type AgendaVisit, isoWithOffset, phoneFromDetails, toAgendaVisits } from './domain/agenda.js';
import { dayMinutes, type ScheduleResource } from './domain/slots.js';
import { addDays, splitRange } from './domain/windows.js';
import { BooksyError } from './errors.js';
import { extensionFor } from './exports/files.js';
import type { Gateway } from './gateway/gateway.js';
import { readCalendar, readShifts } from './tools/composite-tools.js';

/**
 * A scheduled job without an MCP client and without a language model: it saves a fixed list of
 * report exports and, optionally, the staff schedule, through the same gateway as the MCP tools.
 * So the same bridge, the same safe mode, budgets, gaps and stop after a block apply.
 */

export const JOB_EXIT = {
  /** Everything asked for was saved. */
  complete: 0,
  /** Some of it was saved. */
  partial: 1,
  /** Nothing was saved, for reasons other than the two below. */
  nothing: 2,
  /** No extension, no panel tab, or the panel is not ready or logged out. */
  noPanel: 3,
  /** A cooldown, a block by Booksy, a captcha or a used-up budget. */
  blocked: 4,
} as const;

const MAX_JITTER_SECONDS = 3600;
/** Appointment details read per agenda run at most, to find phones the calendar does not show. */
export const DEFAULT_DETAILS_LIMIT = 30;
const MAX_DETAILS_LIMIT = 100;
const KEY = /^[A-Za-z0-9_-]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stops the job and means the panel or the bridge cannot be used now. */
const BRIDGE_CODES = new Set([
  'bridge_port_busy',
  'bridge_not_connected',
  'bridge_timeout',
  'panel_tab_missing',
  'panel_tab_discarded',
  'panel_not_ready',
  'not_logged_in',
  'extension_outdated',
]);
/** Stops the job and means Booksy, or safe mode, wants no more traffic now. */
const BLOCK_CODES = new Set(['blocked_by_booksy', 'captcha_protected', 'budget_exhausted']);

export interface JobExport {
  reportKey: string;
  from: string;
  to: string;
  timeSpan: string;
}

export interface JobOptions {
  exports: JobExport[];
  out: string;
  schedule: { from: string; to: string } | null;
  scheduleOut: string;
  summaryOut: string;
  openPanel: boolean;
  jitterSeconds: number;
  /** Read the calendar for SMS reminders instead of saving reports. Nothing is written to disk. */
  agenda: AgendaRange | null;
}

export interface AgendaRange {
  from: string;
  to: string;
  /** File with Booksy customer ids, one per line, whose phone the caller already knows. */
  knownCustomersFile?: string;
  /** Most appointment details to read for phones. 0 reads none. */
  detailsLimit?: number;
}

function isDate(value: string | undefined): value is string {
  if (!value || !DATE.test(value)) return false;
  try {
    splitRange(value, value);
    return true;
  } catch {
    return false;
  }
}

/** "month" for a whole calendar month, as the panel sends it, otherwise "between". */
export function timeSpanFor(from: string, to: string): string {
  const wholeMonth =
    from.endsWith('-01') && to.slice(0, 7) === from.slice(0, 7) && addDays(to, 1).endsWith('-01');
  return wholeMonth ? 'month' : 'between';
}

export const JOB_HELP = `booksy-mcp job: save reports and the staff schedule without an MCP client.

  --exports a,b,c          Report keys (from stats_report_catalog) for the period --from .. --to.
  --from, --to YYYY-MM-DD  Period of --exports.
  --export key[:from:to]   One report, with its own period. Can repeat. Without dates it uses
                           --from and --to.
  --time-span <value>      Period type sent to Booksy. Default: month for a whole calendar month,
                           otherwise between.
  --out <folder>           Where the files go. Each report is saved as <key>_<from>_<to>.xlsx.
  --schedule <from> <to>   Also save the staff schedule for these days.
  --schedule-out <file>    Default: <out>/schedule.json.
  --summary <file>         Default: <out>/summary.json. The summary is also printed on stdout.
  --open-panel             When no Booksy Biz tab is open, open one in the background and close it
                           at the end. Off by default.
  --jitter <seconds>       Wait a random time from 0 to this before the first request.
  --agenda                 Read the calendar for --from .. --to and print the appointments, with
                           customer phone numbers, as one JSON object on stdout, for SMS
                           reminders. Writes no files. Cannot be combined with reports or the
                           schedule, --out is not needed.
                           Customers who booked in the Booksy app have no phone in the
                           calendar: for them it reads the appointment details, earliest
                           first, at most --details-limit per run.
  --known-customers <file> With --agenda: customer ids, one per line, whose phone the caller
                           already has. Their appointment details are not read.
  --details-limit <n>      With --agenda: most appointment details per run. Default ${DEFAULT_DETAILS_LIMIT},
                           0 reads none.

Exit codes: 0 complete, 1 partial, 2 nothing saved, 3 no extension or panel, 4 cooldown or block.
`;

export function parseJobArgs(args: string[]): JobOptions | { error: string } {
  let keys: string[] = [];
  const single: Array<{ key: string; from?: string; to?: string }> = [];
  let from: string | undefined;
  let to: string | undefined;
  let timeSpan: string | undefined;
  let out: string | undefined;
  let schedule: { from: string; to: string } | null = null;
  let scheduleOut: string | undefined;
  let summaryOut: string | undefined;
  let openPanel = false;
  let jitterSeconds = 0;
  let agenda = false;
  let knownCustomersFile: string | undefined;
  let detailsLimit: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const value = (): string | undefined => {
      i += 1;
      return args[i];
    };
    switch (arg) {
      case '--exports':
        keys = (value() ?? '').split(',').map((key) => key.trim()).filter(Boolean);
        break;
      case '--export': {
        const [key = '', start, end, ...rest] = (value() ?? '').split(':');
        if (rest.length > 0 || (start === undefined) !== (end === undefined)) {
          return { error: '--export takes key or key:from:to.' };
        }
        single.push({ key, ...(start ? { from: start } : {}), ...(end ? { to: end } : {}) });
        break;
      }
      case '--from':
        from = value();
        break;
      case '--to':
        to = value();
        break;
      case '--time-span':
        timeSpan = value();
        break;
      case '--out':
        out = value();
        break;
      case '--schedule': {
        const start = value();
        const end = value();
        if (!isDate(start) || !isDate(end)) return { error: '--schedule takes two dates, YYYY-MM-DD.' };
        schedule = { from: start, to: end };
        break;
      }
      case '--schedule-out':
        scheduleOut = value();
        break;
      case '--summary':
        summaryOut = value();
        break;
      case '--open-panel':
        openPanel = true;
        break;
      case '--agenda':
        agenda = true;
        break;
      case '--known-customers':
        knownCustomersFile = value();
        if (!knownCustomersFile) return { error: '--known-customers takes a file.' };
        break;
      case '--details-limit': {
        const count = Number(value());
        if (!Number.isInteger(count) || count < 0 || count > MAX_DETAILS_LIMIT) {
          return { error: `--details-limit takes a whole number from 0 to ${MAX_DETAILS_LIMIT}.` };
        }
        detailsLimit = count;
        break;
      }
      case '--jitter': {
        const seconds = Number(value());
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_JITTER_SECONDS) {
          return { error: `--jitter takes whole seconds from 0 to ${MAX_JITTER_SECONDS}.` };
        }
        jitterSeconds = seconds;
        break;
      }
      default:
        return { error: `Unknown option for job: ${arg}` };
    }
  }

  if (agenda) {
    if (keys.length > 0 || single.length > 0 || schedule || scheduleOut || summaryOut || timeSpan) {
      return { error: '--agenda cannot be combined with reports or the schedule.' };
    }
    if (!isDate(from) || !isDate(to)) return { error: '--agenda needs --from and --to, YYYY-MM-DD.' };
    if (to < from) return { error: '--agenda ends before it starts.' };
    const folder = resolve(out ?? '.');
    return {
      exports: [],
      out: folder,
      schedule: null,
      scheduleOut: join(folder, 'schedule.json'),
      summaryOut: join(folder, 'summary.json'),
      openPanel,
      jitterSeconds,
      agenda: {
        from,
        to,
        ...(knownCustomersFile ? { knownCustomersFile: resolve(knownCustomersFile) } : {}),
        detailsLimit: detailsLimit ?? DEFAULT_DETAILS_LIMIT,
      },
    };
  }
  if (knownCustomersFile !== undefined || detailsLimit !== undefined) {
    return { error: '--known-customers and --details-limit go with --agenda only.' };
  }
  if (!out) return { error: 'job needs --out <folder>.' };
  if ((from === undefined) !== (to === undefined)) return { error: 'Give both --from and --to.' };
  if (from !== undefined && (!isDate(from) || !isDate(to))) {
    return { error: '--from and --to take YYYY-MM-DD.' };
  }
  if (timeSpan !== undefined && !KEY.test(timeSpan)) return { error: 'Invalid --time-span.' };
  if (keys.length > 0 && from === undefined) return { error: '--exports needs --from and --to.' };

  const exports: JobExport[] = [];
  const add = (key: string, start: string | undefined, end: string | undefined): string | null => {
    if (!KEY.test(key)) return `Invalid report key "${key}".`;
    if (!isDate(start) || !isDate(end)) return `Report ${key} needs a period, YYYY-MM-DD.`;
    if (end < start) return `Report ${key} ends before it starts.`;
    exports.push({ reportKey: key, from: start, to: end, timeSpan: timeSpan ?? timeSpanFor(start, end) });
    return null;
  };
  for (const key of keys) {
    const error = add(key, from, to);
    if (error) return { error };
  }
  for (const entry of single) {
    const error = add(entry.key, entry.from ?? from, entry.to ?? to);
    if (error) return { error };
  }
  if (exports.length === 0 && !schedule) return { error: 'Nothing to do: give --exports, --export or --schedule.' };
  if (schedule && schedule.to < schedule.from) return { error: '--schedule ends before it starts.' };

  const folder = resolve(out);
  return {
    exports,
    out: folder,
    schedule,
    scheduleOut: resolve(scheduleOut ?? join(folder, 'schedule.json')),
    summaryOut: resolve(summaryOut ?? join(folder, 'summary.json')),
    openPanel,
    jitterSeconds,
    agenda: null,
  };
}

export interface ExportOutcome {
  report_key: string;
  from: string;
  to: string;
  time_span: string;
  ok: boolean;
  file?: string;
  bytes?: number;
  error_code?: string;
  error?: string;
}

export interface ScheduleOutcome {
  from: string;
  to: string;
  ok: boolean;
  file?: string;
  staff?: number;
  error_code?: string;
  error?: string;
}

export interface JobSummary {
  version: 1;
  exit_code: number;
  status: 'complete' | 'partial' | 'nothing' | 'no_panel' | 'blocked';
  error_code: string | null;
  reason: string | null;
  started_at: string;
  finished_at: string;
  jitter_seconds: number;
  panel: { business_id: string | null; business_name: string | null } | null;
  opened_tab: boolean;
  exports: ExportOutcome[];
  schedule: ScheduleOutcome | null;
}

/** The schedule as the job saves it: minutes per staff member and day, every day of the range. */
export interface JobSchedule {
  from: string;
  to: string;
  business_id: string | null;
  staff: Array<{
    id: string | null;
    name: string | null;
    type: string | null;
    month_minutes: Record<string, number>;
    days: Record<
      string,
      {
        minutes: number;
        scheduled_minutes: number;
        time_off_minutes: number;
        hours: Array<{ from: string | null; till: string | null }>;
      }
    >;
  }>;
  business_days: unknown[];
}

export function scheduleFile(
  from: string,
  to: string,
  businessId: string | null,
  resources: ScheduleResource[],
  business: unknown[],
): JobSchedule {
  const dates: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day);
  return {
    from,
    to,
    business_id: businessId,
    staff: resources.map((resource) => {
      const byDate = new Map((resource.schedule ?? []).map((day) => [day.date, day]));
      const days: JobSchedule['staff'][number]['days'] = {};
      const months: Record<string, number> = {};
      for (const date of dates) {
        const day = byDate.get(date);
        const counted = dayMinutes(day);
        days[date] = {
          minutes: counted.work,
          scheduled_minutes: counted.scheduled,
          time_off_minutes: counted.timeOff,
          hours: (day?.hours ?? []).map((hours) => ({
            from: hours.hour_from ?? null,
            till: hours.hour_till ?? null,
          })),
        };
        const month = date.slice(0, 7);
        months[month] = (months[month] ?? 0) + counted.work;
      }
      const type = (resource as { type?: unknown }).type;
      return {
        id: resource.id === undefined ? null : String(resource.id),
        name: resource.name ?? null,
        type: typeof type === 'string' ? type : null,
        month_minutes: months,
        days,
      };
    }),
    business_days: business,
  };
}

export interface JobDeps {
  gateway: Gateway;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (line: string) => void;
}

type Stop = { kind: 'bridge' | 'block'; code: string; message: string };

function errorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof BooksyError) return { code: error.code, message: error.message };
  return { code: 'internal_error', message: (error as Error).message };
}

function stopFor(code: string, message: string): Stop | null {
  if (BLOCK_CODES.has(code)) return { kind: 'block', code, message };
  if (BRIDGE_CODES.has(code)) return { kind: 'bridge', code, message };
  return null;
}

function writeSafely(path: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { mode: 0o600 });
}

export function exitCodeFor(okCount: number, total: number, stop: Stop | null): number {
  if (stop?.kind === 'block') return JOB_EXIT.blocked;
  if (total > 0 && okCount === total) return JOB_EXIT.complete;
  if (okCount > 0) return JOB_EXIT.partial;
  if (stop?.kind === 'bridge') return JOB_EXIT.noPanel;
  return JOB_EXIT.nothing;
}

const STATUS: Record<number, JobSummary['status']> = {
  0: 'complete',
  1: 'partial',
  2: 'nothing',
  3: 'no_panel',
  4: 'blocked',
};

export async function runJob(options: JobOptions, deps: JobDeps): Promise<JobSummary> {
  const { gateway } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const random = deps.random ?? Math.random;
  const log = deps.log ?? (() => undefined);
  const started = now();

  const exports: ExportOutcome[] = options.exports.map((entry) => ({
    report_key: entry.reportKey,
    from: entry.from,
    to: entry.to,
    time_span: entry.timeSpan,
    ok: false,
  }));
  const schedule: ScheduleOutcome | null = options.schedule ? { ...options.schedule, ok: false } : null;
  let stop: Stop | null = null;
  let panel: JobSummary['panel'] = null;
  let openedTab: number | null = null;

  const jitter = Math.floor(random() * options.jitterSeconds);
  if (jitter > 0) {
    log(`waiting ${jitter} s before the first request`);
    await sleep(jitter * 1000);
  }

  const fail = (target: ExportOutcome | ScheduleOutcome, error: unknown): void => {
    const { code, message } = errorInfo(error);
    target.error_code = code;
    target.error = message;
    stop = stopFor(code, message);
  };

  try {
    try {
      if (options.openPanel) {
        const tab = await gateway.openPanel();
        if (tab.opened) openedTab = tab.tabId;
      }
      const context = await gateway.context(true);
      panel = { business_id: context.businessId, business_name: context.businessName };
    } catch (error) {
      const { code, message } = errorInfo(error);
      stop = stopFor(code, message) ?? { kind: 'bridge', code, message };
    }

    if (!stop && schedule) {
      try {
        const shifts = await gateway.scope(() =>
          readShifts({ gateway }, schedule.from, schedule.to, true),
        );
        const file = scheduleFile(
          schedule.from,
          schedule.to,
          panel?.business_id ?? null,
          shifts.resources,
          shifts.business,
        );
        writeSafely(options.scheduleOut, `${JSON.stringify(file, null, 2)}\n`);
        schedule.ok = true;
        schedule.file = options.scheduleOut;
        schedule.staff = file.staff.length;
        log(`schedule ${schedule.from}..${schedule.to}: ${file.staff.length} staff`);
      } catch (error) {
        fail(schedule, error);
        log(`schedule failed: ${schedule.error_code}`);
      }
    }

    for (const [index, entry] of options.exports.entries()) {
      if (stop) break;
      const outcome = exports[index] as ExportOutcome;
      try {
        const file = await gateway.scope(async () => {
          gateway.assertRange(entry.from, entry.to, gateway.traffic.maxReportDays);
          return gateway.download('stats.download', {
            params: {
              date_from: entry.from,
              date_till: entry.to,
              time_span: entry.timeSpan,
              report_key: entry.reportKey,
            },
          });
        });
        const path = join(
          options.out,
          `${entry.reportKey}_${entry.from}_${entry.to}${extensionFor(file.contentType, '.xlsx')}`,
        );
        writeSafely(path, file.bytes);
        outcome.ok = true;
        outcome.file = path;
        outcome.bytes = file.bytes.length;
        log(`${entry.reportKey} ${entry.from}..${entry.to}: ${file.bytes.length} bytes`);
      } catch (error) {
        fail(outcome, error);
        log(`${entry.reportKey} ${entry.from}..${entry.to} failed: ${outcome.error_code}`);
      }
    }
  } finally {
    if (openedTab !== null) {
      try {
        await gateway.closePanel(openedTab);
      } catch {
        // The tab stays open. Nothing else to do from here.
      }
    }
  }

  const finalStop = stop as Stop | null;
  if (finalStop) {
    const skipped = `Not tried: the job stopped after ${finalStop.code}.`;
    for (const outcome of [...exports, ...(schedule ? [schedule] : [])]) {
      if (outcome.ok || outcome.error_code) continue;
      outcome.error_code = 'skipped';
      outcome.error = skipped;
    }
  }

  const items = [...exports.map((entry) => entry.ok), ...(schedule ? [schedule.ok] : [])];
  const okCount = items.filter(Boolean).length;
  const exitCode = exitCodeFor(okCount, items.length, finalStop);
  const firstError = [...(schedule ? [schedule] : []), ...exports].find(
    (entry) => entry.error_code && entry.error_code !== 'skipped',
  );
  const summary: JobSummary = {
    version: 1,
    exit_code: exitCode,
    status: STATUS[exitCode] as JobSummary['status'],
    error_code: finalStop?.code ?? firstError?.error_code ?? null,
    reason: finalStop?.message ?? firstError?.error ?? null,
    started_at: started.toISOString(),
    finished_at: now().toISOString(),
    jitter_seconds: jitter,
    panel,
    opened_tab: openedTab !== null,
    exports,
    schedule,
  };
  writeSafely(options.summaryOut, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

/** The agenda as Agents Hub OS takes it. A failed run prints nothing, the caller reports it. */
export interface AgendaPayload {
  status: 'ok';
  reason: null;
  range_from: string;
  range_to: string;
  complete: boolean;
  fetched_at: string;
  visits: AgendaVisit[];
}

export interface AgendaOutcome {
  exit_code: number;
  error_code: string | null;
  reason: string | null;
  payload: AgendaPayload | null;
}

/**
 * Reads the calendar once for the range, through the same gateway, safe mode and stop after a
 * block as everything else, and keeps the result in memory only: it holds phone numbers.
 */
export async function runAgenda(options: JobOptions, deps: JobDeps): Promise<AgendaOutcome> {
  const range = options.agenda;
  if (!range) throw new Error('runAgenda needs options.agenda');
  const { gateway } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const random = deps.random ?? Math.random;
  const log = deps.log ?? (() => undefined);

  const jitter = Math.floor(random() * options.jitterSeconds);
  if (jitter > 0) {
    log(`waiting ${jitter} s before the first request`);
    await sleep(jitter * 1000);
  }

  let openedTab: number | null = null;
  try {
    if (options.openPanel) {
      const tab = await gateway.openPanel();
      if (tab.opened) openedTab = tab.tabId;
    }
    const context = await gateway.context(true);
    const calendar = await gateway.scope(() =>
      readCalendar({ gateway }, range.from, range.to, true),
    );
    const { visits, skipped } = toAgendaVisits(calendar);
    log(
      `agenda ${range.from}..${range.to}: ${visits.length} visits, ${calendar.windows} calendar ` +
        `requests${skipped > 0 ? `, ${skipped} bookings without an id or a start left out` : ''}`,
    );
    const known = readKnownCustomers(range.knownCustomersFile, log);
    await fillPhones(gateway, visits, known, range.detailsLimit ?? DEFAULT_DETAILS_LIMIT, log);
    return {
      exit_code: JOB_EXIT.complete,
      error_code: null,
      reason: null,
      payload: {
        status: 'ok',
        reason: null,
        range_from: range.from,
        range_to: range.to,
        complete: skipped === 0,
        fetched_at: isoWithOffset(now(), context.timezone ?? null),
        visits,
      },
    };
  } catch (error) {
    const { code, message } = errorInfo(error);
    const stop = stopFor(code, message);
    log(`agenda failed: ${code}`);
    return {
      exit_code: stop?.kind === 'block' ? JOB_EXIT.blocked : stop ? JOB_EXIT.noPanel : JOB_EXIT.nothing,
      error_code: code,
      reason: message,
      payload: null,
    };
  } finally {
    if (openedTab !== null) {
      try {
        await gateway.closePanel(openedTab);
      } catch {
        // The tab stays open. Nothing else to do from here.
      }
    }
  }
}

/** Customer ids from the caller's file. A file that cannot be read counts as an empty list. */
export function readKnownCustomers(
  file: string | undefined,
  log: (line: string) => void,
): Set<number> {
  const known = new Set<number>();
  if (!file) return known;
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    log(`known customers not read (${(error as NodeJS.ErrnoException).code ?? 'error'}), reading details for all`);
    return known;
  }
  for (const line of content.split(/\r?\n/)) {
    const id = line.trim();
    if (/^\d{1,15}$/.test(id)) known.add(Number(id));
  }
  return known;
}

/**
 * Phones the calendar does not show (customers from the Booksy app) from the appointment details:
 * one request per customer, earliest visit first, skipping customers the caller already knows, at
 * most `limit` requests. Each request is its own gateway call, so the safe mode gaps and budgets
 * apply. A block, a captcha, a used-up budget or a lost panel stops it without a retry; what was
 * found so far stays. Other errors skip that one visit. Changes `visits` in place.
 */
export async function fillPhones(
  gateway: Gateway,
  visits: AgendaVisit[],
  known: Set<number>,
  limit: number,
  log: (line: string) => void,
): Promise<{ read: number; found: number; stopped: string | null }> {
  const byCustomer = new Map<number, AgendaVisit[]>();
  for (const visit of visits) {
    if (visit.phone || visit.customer_id === null || known.has(visit.customer_id)) continue;
    const list = byCustomer.get(visit.customer_id) ?? [];
    list.push(visit);
    byCustomer.set(visit.customer_id, list);
  }
  let read = 0;
  let found = 0;
  let stopped: string | null = null;
  const errors = new Map<string, number>();
  for (const list of byCustomer.values()) {
    if (read >= limit) break;
    const first = list[0] as AgendaVisit;
    read += 1;
    try {
      const response = await gateway.scope(() =>
        gateway.request('appointment.read', { urlParams: { appointmentUid: String(first.visit_id) } }),
      );
      const phone = phoneFromDetails(response.data);
      if (phone) {
        found += 1;
        for (const visit of list) visit.phone = phone;
      }
    } catch (error) {
      const { code, message } = errorInfo(error);
      errors.set(code, (errors.get(code) ?? 0) + 1);
      if (stopFor(code, message)) {
        stopped = code;
        break;
      }
    }
  }
  if (byCustomer.size > 0) {
    const left = byCustomer.size - found;
    log(
      `phones from appointment details: ${found} found in ${read} requests, ${left} customers ` +
        `still without a phone${stopped ? `, stopped after ${stopped}` : ''}` +
        (errors.size > 0 ? `, errors: ${[...errors].map(([c, n]) => `${c} x${n}`).join(', ')}` : ''),
    );
  }
  return { read, found, stopped };
}
