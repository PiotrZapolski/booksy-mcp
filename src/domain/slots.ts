import { type RawBooking, toVisits } from './bookings.js';

interface Range {
  from: number;
  till: number;
}

interface ScheduleDay {
  date?: string;
  hours?: Array<{ hour_from?: string; hour_till?: string }>;
  time_offs?: Array<{ hour_from?: string; hour_till?: string; all_day?: boolean }>;
}

export interface ScheduleResource {
  id?: number | string;
  name?: string;
  schedule?: ScheduleDay[];
}

export interface OpenSlot {
  resource_id: string;
  resource_name: string | null;
  date: string;
  from: string;
  till: string;
  starts: string[];
}

/** Totals that only hold for one week, so they are dropped once several weeks are joined. */
const WEEK_TOTALS = ['week_work_duration', 'week_scheduled_duration'];

/** The shifts answer keeps id and name under `resource`, next to `schedule`. */
export function flattenResource(raw: unknown): ScheduleResource {
  const { resource, ...rest } = (raw ?? {}) as ScheduleResource & { resource?: object };
  return { ...resource, ...rest };
}

/** One entry per resource, with the days of all weeks. An entry without id or name stays apart. */
export function joinResourceWeeks(weeks: ScheduleResource[][]): ScheduleResource[] {
  const joined = new Map<string, ScheduleResource>();
  weeks.forEach((week, weekIndex) => {
    week.forEach((resource, index) => {
      const key = String(resource.id ?? resource.name ?? `${weekIndex}-${index}`);
      const known = joined.get(key);
      if (!known) {
        joined.set(key, { ...resource, schedule: [...(resource.schedule ?? [])] });
        return;
      }
      known.schedule = [...(known.schedule ?? []), ...(resource.schedule ?? [])];
      for (const total of WEEK_TOTALS) delete (known as Record<string, unknown>)[total];
    });
  });
  return [...joined.values()];
}

function minutes(value: string | undefined): number | null {
  const match = value ? /^(\d{2}):(\d{2})/.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clock(total: number): string {
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  return `${hours}:${String(total % 60).padStart(2, '0')}`;
}

function subtract(free: Range[], busy: Range): Range[] {
  return free.flatMap((range) => {
    if (busy.till <= range.from || busy.from >= range.till) return [range];
    const parts: Range[] = [];
    if (busy.from > range.from) parts.push({ from: range.from, till: busy.from });
    if (busy.till < range.till) parts.push({ from: busy.till, till: range.till });
    return parts;
  });
}

function bookingMinutes(start: string, end: string | null, date: string): Range | null {
  if (!start.startsWith(date)) return null;
  const from = minutes(start.slice(11));
  if (from === null) return null;
  const till = end?.startsWith(date) ? minutes(end.slice(11)) : 24 * 60;
  return till === null ? null : { from, till };
}

/**
 * Free time of each resource on one date: working hours minus time off minus bookings. Computed
 * locally, so finding slots sends nothing extra to Booksy.
 */
export function openSlots(options: {
  date: string;
  durationMinutes: number;
  stepMinutes: number;
  resources: ScheduleResource[];
  bookings: RawBooking[];
  resourceId?: string;
}): OpenSlot[] {
  const { date, durationMinutes, stepMinutes } = options;
  const visits = toVisits(options.bookings).filter((visit) => {
    return !['C', 'D', 'R'].includes(visit.status ?? '');
  });

  const slots: OpenSlot[] = [];
  for (const resource of options.resources) {
    const id = resource.id === undefined ? null : String(resource.id);
    if (!id || (options.resourceId && options.resourceId !== id)) continue;

    const day = resource.schedule?.find((entry) => entry.date === date);
    if (!day) continue;

    let free: Range[] = (day.hours ?? []).flatMap((hours) => {
      const from = minutes(hours.hour_from);
      const till = minutes(hours.hour_till);
      return from !== null && till !== null && till > from ? [{ from, till }] : [];
    });

    for (const off of day.time_offs ?? []) {
      if (off.all_day) {
        free = [];
        break;
      }
      const from = minutes(off.hour_from);
      const till = minutes(off.hour_till);
      if (from !== null && till !== null) free = subtract(free, { from, till });
    }

    for (const visit of visits) {
      if (!visit.staffIds.includes(id)) continue;
      const busy = bookingMinutes(visit.start, visit.end, date);
      if (busy) free = subtract(free, busy);
    }

    for (const range of free) {
      if (range.till - range.from < durationMinutes) continue;
      const starts: string[] = [];
      for (let at = range.from; at + durationMinutes <= range.till; at += stepMinutes) {
        starts.push(clock(at));
      }
      slots.push({
        resource_id: id,
        resource_name: resource.name ?? null,
        date,
        from: clock(range.from),
        till: clock(range.till),
        starts,
      });
    }
  }
  return slots;
}
