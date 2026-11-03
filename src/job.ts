import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { dayMinutes, type ScheduleResource } from './domain/slots.js';
import { addDays, splitRange } from './domain/windows.js';
import { BooksyError } from './errors.js';
import { extensionFor } from './exports/files.js';
import type { Gateway } from './gateway/gateway.js';
import { readShifts } from './tools/composite-tools.js';

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
