import { BooksyError } from '../errors.js';

export const MAX_WINDOW_DAYS = 31;
const DAY_MS = 86_400_000;

export interface DateWindow {
  start: string;
  end: string;
}

function parse(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new BooksyError('invalid_input', `Dates use YYYY-MM-DD, got "${value}".`);
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(time).toISOString().slice(0, 10) !== value) {
    throw new BooksyError('invalid_input', `"${value}" is not a calendar date.`);
  }
  return time;
}

function format(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Splits an inclusive date range into consecutive windows of at most maxDays. */
export function splitRange(from: string, to: string, maxDays = MAX_WINDOW_DAYS): DateWindow[] {
  const start = parse(from);
  const end = parse(to);
  if (end < start) throw new BooksyError('invalid_input', 'The end date is before the start date.');

  const windows: DateWindow[] = [];
  for (let cursor = start; cursor <= end; cursor += maxDays * DAY_MS) {
    windows.push({
      start: format(cursor),
      end: format(Math.min(cursor + (maxDays - 1) * DAY_MS, end)),
    });
  }
  return windows;
}

/** Monday of each week that touches the range. */
export function weekStarts(from: string, to: string): string[] {
  const end = parse(to);
  const first = parse(from);
  if (end < first) throw new BooksyError('invalid_input', 'The end date is before the start date.');
  const day = new Date(first).getUTCDay();
  const weeks: string[] = [];
  for (let cursor = first - ((day + 6) % 7) * DAY_MS; cursor <= end; cursor += 7 * DAY_MS) {
    weeks.push(format(cursor));
  }
  return weeks;
}

export function addDays(date: string, days: number): string {
  return format(parse(date) + days * DAY_MS);
}

export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
