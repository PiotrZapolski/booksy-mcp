import { z } from 'zod';
import { mergeBookings, type RawBooking, toVisits } from '../domain/bookings.js';
import { diffVisits, type Snapshot } from '../domain/feed.js';
import { openSlots, type ScheduleResource } from '../domain/slots.js';
import { addDays, splitRange, today, weekStarts } from '../domain/windows.js';
import { BooksyError } from '../errors.js';
import { schema, type Args, type ToolContext, type ToolDef } from './define.js';

interface CalendarPayload {
  bookings?: RawBooking[];
  [key: string]: unknown;
}

interface ShiftsPayload {
  schedule?: {
    business?: { schedule?: Array<{ date?: string }> } & Record<string, unknown>;
    resources?: ScheduleResource[];
    time_off_reasons?: unknown;
  };
}

/** Reads any date range, one window after another, and merges the results. */
export async function readCalendar(
  context: ToolContext,
  from: string,
  to: string,
  fresh = false,
): Promise<{ bookings: RawBooking[]; windows: number; timeOffs: unknown[] }> {
  context.gateway.assertRange(from, to);
  const windows = splitRange(from, to, context.gateway.traffic.windowDays);
  const batches: RawBooking[][] = [];
  const timeOffs: unknown[] = [];
  let pause = false;
  for (const window of windows) {
    if (pause) await context.gateway.pause();
    const response = await context.gateway.request('calendar.range', {
      params: {
        start_date: window.start,
        end_date: window.end,
        include_unconfirmed: true,
        version: 3,
        resources_per_page: 100,
      },
      fresh,
    });
    pause = !response.fromCache;
    const payload = response.data as CalendarPayload;
    batches.push(payload.bookings ?? []);
    const resources = payload.resources as { time_offs?: unknown[] } | undefined;
    if (Array.isArray(resources?.time_offs)) timeOffs.push(...resources.time_offs);
  }
  return { bookings: mergeBookings(batches), windows: windows.length, timeOffs };
}

export async function readShifts(
  context: ToolContext,
  from: string,
  to: string,
  fresh = false,
): Promise<{ business: unknown[]; resources: ScheduleResource[]; reasons: unknown }> {
  context.gateway.assertRange(from, to);
  const business: Array<{ date?: string }> = [];
  const resources = new Map<string, ScheduleResource>();
  let reasons: unknown = null;

  let pause = false;
  for (const week of weekStarts(from, to)) {
    if (pause) await context.gateway.pause();
    const response = await context.gateway.request('shifts.week', {
      params: { week_start_date: week },
      fresh,
    });
    pause = !response.fromCache;
    const schedule = (response.data as ShiftsPayload).schedule;
    business.push(...(schedule?.business?.schedule ?? []));
    reasons = schedule?.time_off_reasons ?? reasons;
    for (const resource of schedule?.resources ?? []) {
      const id = String(resource.id);
      const known = resources.get(id);
      if (known) known.schedule = [...(known.schedule ?? []), ...(resource.schedule ?? [])];
      else resources.set(id, { ...resource, schedule: [...(resource.schedule ?? [])] });
    }
  }

  const inRange = <T extends { date?: string }>(days: T[]): T[] =>
    days.filter((day) => !day.date || (day.date >= from && day.date <= to));
  return {
    business: inRange(business),
    resources: [...resources.values()].map((resource) => ({
      ...resource,
      schedule: inRange(resource.schedule ?? []),
    })),
    reasons,
  };
}

const session: ToolDef = {
  name: 'session_status',
  title: 'Session status',
  description:
    'Shows whether the extension is connected, the pairing code when pairing is needed, the salon ' +
    'open in the panel, enabled write tools, the traffic mode, budget use and any cooldown. Start here.',
  input: {},
  write: false,
  async handler(_args, context) {
    const bridge = context.bridgeStatus();
    const traffic = context.gateway.status();
    const base = { bridge, traffic, write_tools: context.config.writeTools };
    const stopped = traffic.cooldown.active
      ? {
          next:
            `All requests are stopped until ${traffic.cooldown.until} after ` +
            `${traffic.cooldown.reason}. Tell the user, and do not work around it.`,
        }
      : {};
    if (bridge.portBusy) {
      return {
        ...base,
        next: `Port ${bridge.port} is taken, probably by another MCP client running booksy-mcp.`,
      };
    }
    if (!bridge.connected) {
      return {
        ...base,
        next: bridge.pairingCode
          ? `In Chrome, open the Booksy MCP Bridge popup and enter the code ${bridge.pairingCode}.`
          : 'Open Chrome. The extension connects by itself within 30 seconds.',
      };
    }
    try {
      return { ...base, panel: await context.gateway.context(true), ...stopped };
    } catch (error) {
      if (error instanceof BooksyError) return { ...base, panel: null, next: error.message };
      throw error;
    }
  },
};

const calendarAgenda: ToolDef = {
  name: 'calendar_agenda',
  title: 'Calendar agenda',
  description:
    'Appointments between two dates. Long ranges are split into windows and read one after another ' +
    'with a pause. In safe mode a range can have at most 92 days. Filter by staff or by status (A accepted, W waiting for confirmation, ' +
    'C canceled, D declined, F finished, N no-show, M modified, O prepayment awaiting, P proposed, ' +
    'R rejected, V unverified).',
  input: {
    from: schema.date('First day'),
    to: schema.date('Last day'),
    staff_id: schema.id('Only this staff member or station').optional(),
    status: z.array(z.string().length(1)).optional().describe('Only these status codes'),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    const { bookings, windows, timeOffs } = await readCalendar(
      context,
      args.from as string,
      args.to as string,
      args.fresh === true,
    );
    const statuses = args.status as string[] | undefined;
    const staffId = args.staff_id as string | undefined;
    const filtered = bookings.filter((booking) => {
      const [visit] = toVisits([booking]);
      if (statuses && !statuses.includes(visit?.status ?? '')) return false;
      return !staffId || (visit?.staffIds.includes(staffId) ?? false);
    });
    return { count: filtered.length, windows_read: windows, bookings: filtered, time_offs: timeOffs };
  },
};

const appointmentRequests: ToolDef = {
  name: 'appointment_requests',
  title: 'Booking requests waiting',
  description: 'Appointments that wait for the salon to confirm or decline, from today on.',
  input: {
    days_ahead: z.number().int().min(1).max(366).default(31).describe('How far ahead to look'),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    const from = today(context.now());
    const to = addDays(from, args.days_ahead as number);
    const { bookings } = await readCalendar(context, from, to, args.fresh === true);
    const waiting = bookings.filter((booking) => toVisits([booking])[0]?.status === 'W');
    return { count: waiting.length, bookings: waiting };
  },
};

const slots: ToolDef = {
  name: 'calendar_open_slots',
  title: 'Open slots',
  description:
    'Free time per staff member on one date, worked out locally from shifts, time off and bookings. ' +
    'Use it before proposing a time to a client.',
  input: {
    date: schema.date('Day'),
    duration_minutes: z.number().int().min(5).max(720).describe('Length of the visit'),
    step_minutes: z.number().int().min(5).max(120).default(15).describe('Gap between start times'),
    staff_id: schema.id('Only this staff member').optional(),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    const date = args.date as string;
    const fresh = args.fresh === true;
    const shifts = await readShifts(context, date, date, fresh);
    const { bookings } = await readCalendar(context, date, date, fresh);
    const staffId = args.staff_id as string | undefined;
    return {
      date,
      slots: openSlots({
        date,
        durationMinutes: args.duration_minutes as number,
        stepMinutes: args.step_minutes as number,
        resources: shifts.resources,
        bookings,
        ...(staffId ? { resourceId: staffId } : {}),
      }),
    };
  },
};

const feed: ToolDef = {
  name: 'appointment_changes_feed',
  title: 'Appointment changes',
  description:
    'New, moved, cancelled and otherwise changed appointments since the last call. The first call ' +
    'stores a baseline. Compares the calendar with a small local snapshot of ids, times and status.',
  input: {
    days_back: z.number().int().min(0).max(31).default(1).describe('Days before today to watch'),
    days_ahead: z.number().int().min(1).max(366).default(60).describe('Days after today to watch'),
  },
  write: false,
  async handler(args, context) {
    const panel = await context.gateway.context();
    if (!panel.businessId) throw new BooksyError('panel_not_ready', 'No salon is open in the panel.');

    const day = today(context.now());
    const start = addDays(day, -(args.days_back as number));
    const end = addDays(day, args.days_ahead as number);
    const { bookings } = await readCalendar(context, start, end, true);
    const visits = toVisits(bookings);

    const previous = context.snapshots.load(panel.businessId);
    const snapshot: Snapshot = {
      takenAt: context.now().toISOString(),
      rangeStart: start,
      rangeEnd: end,
      visits: Object.fromEntries(visits.map((visit) => [visit.uid, visit])),
    };
    context.snapshots.save(panel.businessId, snapshot);

    if (!previous) {
      return { baseline: true, watching: visits.length, range: { start, end } };
    }
    return {
      baseline: false,
      since: previous.takenAt,
      range: { start, end },
      changes: diffVisits(previous, visits, { start, end }),
    };
  },
};

const resources: ToolDef = {
  name: 'team_resources',
  title: 'Staff and stations',
  description:
    'Staff members and stations. Booksy keeps both as resources. Use kind to narrow the list.',
  input: {
    kind: z.enum(['all', 'staff', 'station']).default('all').describe('Which resources'),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    const response = await context.gateway.request('resources.list', {
      fresh: args.fresh === true,
    });
    const list = ((response.data as { resources?: Array<{ type?: string }> }).resources ?? []).filter(
      (resource) =>
        args.kind === 'all' || resource.type === (args.kind === 'staff' ? 'S' : 'R'),
    );
    return { count: list.length, resources: list };
  },
};

const shifts: ToolDef = {
  name: 'staff_schedule',
  title: 'Staff schedule',
  description:
    'Working hours and time off per staff member and day, to the minute, for a date range. Reads ' +
    'one week at a time, with a pause between weeks.',
  input: { from: schema.date('First day'), to: schema.date('Last day'), fresh: schema.fresh },
  write: false,
  async handler(args, context) {
    const schedule = await readShifts(
      context,
      args.from as string,
      args.to as string,
      args.fresh === true,
    );
    return {
      business_days: schedule.business,
      resources: schedule.resources,
      time_off_reasons: schedule.reasons,
    };
  },
};

const timeOff: ToolDef = {
  name: 'time_off_entries',
  title: 'Time off',
  description: 'Time off of each staff member between two dates, with reason codes.',
  input: { from: schema.date('First day'), to: schema.date('Last day'), fresh: schema.fresh },
  write: false,
  async handler(args, context) {
    const schedule = await readShifts(
      context,
      args.from as string,
      args.to as string,
      args.fresh === true,
    );
    const entries = schedule.resources.flatMap((resource) =>
      (resource.schedule ?? []).flatMap((day) =>
        (day.time_offs ?? []).map((off) => ({
          resource_id: resource.id,
          resource_name: resource.name,
          date: day.date,
          ...off,
        })),
      ),
    );
    return { count: entries.length, time_offs: entries, time_off_reasons: schedule.reasons };
  },
};

const openingHours: ToolDef = {
  name: 'opening_hours',
  title: 'Opening hours',
  description: 'Opening hours of the business, day by day, for the week of the given date.',
  input: { date: schema.date('Any day in the week').optional(), fresh: schema.fresh },
  write: false,
  async handler(args, context) {
    const date = (args.date as string | undefined) ?? today(context.now());
    const start = weekStarts(date, date)[0] as string;
    const schedule = await readShifts(context, start, addDays(start, 6), args.fresh === true);
    return { days: schedule.business };
  },
};

const estimate: ToolDef = {
  name: 'campaign_estimate',
  title: 'Campaign cost estimate',
  description: 'Number of recipients and SMS cost for a campaign. Sends nothing.',
  input: {
    recipients: z.record(z.string(), z.unknown()).describe('Audience object, as in the campaign'),
    body_short: z.string().max(1000).describe('SMS text'),
    channel_priority: z.record(z.string(), z.unknown()).optional().describe('Channel order'),
  },
  write: false,
  async handler(args, context) {
    const response = await context.gateway.request('campaigns.estimate', {
      data: {
        ...(args.recipients as object),
        body_short: args.body_short,
        channel_priority: args.channel_priority,
      },
    });
    return response.data;
  },
};

const chatList: ToolDef = {
  name: 'chat_conversations',
  title: 'Client conversations',
  description:
    'Client chat conversations, newest first. Works only where the panel has client chat enabled.',
  input: {
    limit: z.number().int().min(1).max(30).default(20).describe('How many'),
    offset: z.number().int().min(0).default(0).describe('How many to skip'),
  },
  write: false,
  handler: (args: Args, context) =>
    context.gateway.chat({
      action: 'list',
      limit: args.limit as number,
      offset: args.offset as number,
    }),
};

const chatMessages: ToolDef = {
  name: 'chat_messages',
  title: 'Conversation messages',
  description: 'Latest messages of one client conversation.',
  input: {
    channel_id: schema.id('Conversation id'),
    limit: z.number().int().min(1).max(100).default(30).describe('How many'),
  },
  write: false,
  handler: (args: Args, context) =>
    context.gateway.chat({
      action: 'read',
      channelId: args.channel_id as string,
      limit: args.limit as number,
    }),
};

export const COMPOSITE_TOOLS: ToolDef[] = [
  session,
  calendarAgenda,
  appointmentRequests,
  slots,
  feed,
  resources,
  shifts,
  timeOff,
  openingHours,
  estimate,
  chatList,
  chatMessages,
];
