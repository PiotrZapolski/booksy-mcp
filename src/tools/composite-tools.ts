import { z } from 'zod';
import {
  calendarResourceNames,
  calendarTimeOffs,
  mergeBookings,
  type RawBooking,
  recordList,
  reservationsAsBookings,
  toVisits,
} from '../domain/bookings.js';
import { diffVisits, type Snapshot } from '../domain/feed.js';
import { flattenResource, joinResourceWeeks, openSlots, type ScheduleResource } from '../domain/slots.js';
import { addDays, splitRange, today, weekStarts } from '../domain/windows.js';
import { BooksyError } from '../errors.js';
import { schema, type Args, type ToolContext, type ToolDef } from './define.js';

interface ShiftsPayload {
  schedule?: {
    business?: { schedule?: Array<{ date?: string }> } & Record<string, unknown>;
    resources?: unknown[];
    time_off_reasons?: unknown;
  };
}

/** Reads any date range, one window after another, and merges the results. */
export async function readCalendar(
  context: Pick<ToolContext, 'gateway'>,
  from: string,
  to: string,
  fresh = false,
): Promise<{
  bookings: RawBooking[];
  reservations: RawBooking[];
  windows: number;
  timeOffs: unknown[];
  resourceNames: Record<string, string>;
}> {
  context.gateway.assertRange(from, to);
  const windows = splitRange(from, to, context.gateway.traffic.windowDays);
  const batches: RawBooking[][] = [];
  const reservationBatches: RawBooking[][] = [];
  const timeOffs: unknown[] = [];
  const resourceNames: Record<string, string> = {};
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
    const payload = response.data as Record<string, unknown>;
    batches.push(recordList(payload.bookings));
    reservationBatches.push(recordList(payload.reservations));
    timeOffs.push(...calendarTimeOffs(payload.resources));
    Object.assign(resourceNames, calendarResourceNames(payload.resources));
  }
  return {
    bookings: mergeBookings(batches),
    reservations: mergeBookings(reservationBatches),
    windows: windows.length,
    timeOffs,
    resourceNames,
  };
}

export async function readShifts(
  context: Pick<ToolContext, 'gateway'>,
  from: string,
  to: string,
  fresh = false,
): Promise<{ business: unknown[]; resources: ScheduleResource[]; reasons: unknown }> {
  context.gateway.assertRange(from, to);
  const business: Array<{ date?: string }> = [];
  const weeks: ScheduleResource[][] = [];
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
    weeks.push((schedule?.resources ?? []).map(flattenResource));
  }

  const inRange = <T extends { date?: string }>(days: T[]): T[] =>
    days.filter((day) => !day.date || (day.date >= from && day.date <= to));
  return {
    business: inRange(business),
    resources: joinResourceWeeks(weeks).map((resource) => ({
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
    'Shows whether the browser extension is connected, the pairing code when pairing is needed, ' +
    'the salon open in the panel (name, id, country, timezone), the enabled write tools, the ' +
    'traffic mode, budget use and any cooldown. It also lists the tool groups in tool_groups: ' +
    'only the core group is listed by default, and payments, inventory, vouchers, marketing, ' +
    'business and diagnostics tools exist only after the user turns their group on. When a tool ' +
    'the user asks for is missing, check tool_groups and tell them which group to enable ' +
    '(how_to_enable says how). Call it first in every session and again when ' +
    'another tool fails: the next field says what the user has to do. Read-only and free of ' +
    'budget: it reads the open tab and sends nothing to Booksy.',
  input: {},
  write: false,
  async handler(_args, context) {
    const bridge = context.bridgeStatus();
    const traffic = context.gateway.status();
    const base = {
      bridge,
      traffic,
      write_tools: context.config.writeTools,
      tool_groups: context.toolGroups(),
    };
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
    'Returns the calendar between two dates: bookings (full appointment records with ' +
    'appointment_uid, status and times in salon local time), reservations (time blocks) and ' +
    'time_offs. This is the main tool for who is booked when. Use calendar_month for month ' +
    'counters, calendar_open_slots for free time and customer_visit_history for one client. ' +
    'Read-only. Ranges are read in windows of 14 days (31 with safe mode off) with a pause between ' +
    'them, so long ranges are slow, and safe mode refuses more than 92 days.',
  input: {
    from: schema.date('First day of the range'),
    to: schema.date('Last day of the range, inclusive'),
    staff_id: schema
      .id(
        'Only bookings of this staff member or station: an id from team_resources, for example ' +
          '12345. Reservations and time off are not filtered',
      )
      .optional(),
    status: z
      .array(z.string().length(1))
      .optional()
      .describe(
        'Only bookings with these one-letter status codes, for example ["A","F"]: A accepted, ' +
          'W waiting for confirmation, C canceled, D declined, F finished, N no-show, M modified, ' +
          'O prepayment awaiting, P proposed, R rejected, V unverified. All when left out',
      ),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    const { bookings, reservations, windows, timeOffs } = await readCalendar(
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
    return {
      count: filtered.length,
      windows_read: windows,
      bookings: filtered,
      reservations,
      time_offs: timeOffs,
    };
  },
};

const appointmentRequests: ToolDef = {
  name: 'appointment_requests',
  title: 'Booking requests waiting',
  description:
    'Lists the booking requests that wait for the salon to confirm or decline (status W), from ' +
    'today on, as full appointment records. Use it to answer what needs a decision. ' +
    'appointment_confirm and appointment_decline are the write tools that act on them, and ' +
    'calendar_agenda returns every status. Read-only. It reads the calendar in windows, and safe ' +
    'mode refuses more than 92 days in one call.',
  input: {
    days_ahead: z
      .number()
      .int()
      .min(1)
      .max(366)
      .default(31)
      .describe('Days after today to look at, from 1 to 366 (at most 91 in safe mode). Default 31'),
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
    'Returns the free time of each staff member on one date: slots with resource_id, ' +
    'resource_name, from, till and the possible start times (HH:mm, salon local time) for a visit ' +
    'of the given length. Use it before proposing a time to a client or calling appointment_book. ' +
    'Read-only. It is worked out locally from shifts, time off, bookings and time blocks, so it ' +
    'does not apply booking rules of the panel: the dry run of appointment_book is the final check.',
  input: {
    date: schema.date('The day to search'),
    duration_minutes: z
      .number()
      .int()
      .min(5)
      .max(720)
      .describe('Length of the visit in minutes, from 5 to 720, for example 45'),
    step_minutes: z
      .number()
      .int()
      .min(5)
      .max(120)
      .default(15)
      .describe('Minutes between two offered start times, from 5 to 120. Default 15'),
    staff_id: schema
      .id('Only this staff member: an id from team_resources, for example 12345. All staff when left out')
      .optional(),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    const date = args.date as string;
    const fresh = args.fresh === true;
    const shifts = await readShifts(context, date, date, fresh);
    const { bookings, reservations } = await readCalendar(context, date, date, fresh);
    const staffId = args.staff_id as string | undefined;
    return {
      date,
      slots: openSlots({
        date,
        durationMinutes: args.duration_minutes as number,
        stepMinutes: args.step_minutes as number,
        resources: shifts.resources,
        bookings: [...bookings, ...reservationsAsBookings(reservations)],
        ...(staffId ? { resourceId: staffId } : {}),
      }),
    };
  },
};

const feed: ToolDef = {
  name: 'appointment_changes_feed',
  title: 'Appointment changes',
  description:
    'Returns what changed in the calendar since the previous call: changes with the lists new, ' +
    'moved, cancelled, status_changed and disappeared, each entry with the appointment uid and ' +
    'its before and after (status, start, end, staff ids). Use it for "what is new since I last ' +
    'looked"; use calendar_agenda for the current state. The first call only stores a baseline. ' +
    'It sends nothing that changes Booksy, but it does overwrite a small local snapshot (ids, ' +
    'times and statuses, no names) on every call, and it always reads the calendar fresh.',
  input: {
    days_back: z
      .number()
      .int()
      .min(0)
      .max(31)
      .default(1)
      .describe('Days before today to watch, from 0 to 31. Default 1'),
    days_ahead: z
      .number()
      .int()
      .min(1)
      .max(366)
      .default(60)
      .describe(
        'Days after today to watch, from 1 to 366. Default 60. In safe mode days_back plus ' +
          'days_ahead can be at most 91',
      ),
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
    'Lists the staff members and stations of the business with their ids, as count and ' +
    'resources. Booksy keeps both as resources. Use it to get the staff or station ids other ' +
    'tools need (calendar_agenda, calendar_open_slots, appointment_book, time_off_add). One ' +
    'resource in full is in resource_details, and working hours are in staff_schedule. Read-only.',
  input: {
    kind: z
      .enum(['all', 'staff', 'station'])
      .default('all')
      .describe('Which resources to return: all, only staff members or only stations. Default all'),
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
    'Returns the working hours and time off of every staff member, day by day and to the minute ' +
    '(HH:mm, salon local time), for a date range: business_days, resources with their schedule, ' +
    'and time_off_reasons. Use it for who works when. time_off_entries gives only the time off as ' +
    'a flat list, opening_hours only the hours of the salon, and calendar_open_slots the free ' +
    'time left after bookings. Read-only. It reads one week per request with a pause between ' +
    'weeks, and safe mode refuses more than 92 days.',
  input: {
    from: schema.date('First day of the range'),
    to: schema.date('Last day of the range, inclusive'),
    fresh: schema.fresh,
  },
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
  description:
    'Lists the time off of all staff between two dates as a flat list: one entry per staff ' +
    'member and day with resource_id, resource_name, date and the fields of the entry, plus ' +
    'time_off_reasons with the reason codes of the salon. Use it for holidays and absences, and ' +
    'to get the reason code that time_off_add needs. Full working hours are in staff_schedule. ' +
    'Read-only. It reads one week per request, and safe mode refuses more than 92 days.',
  input: {
    from: schema.date('First day of the range'),
    to: schema.date('Last day of the range, inclusive'),
    fresh: schema.fresh,
  },
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
  description:
    'Returns the opening hours of the business for one week, day by day, under days. Use it for ' +
    'when the salon is open in a given week. The hours of single staff members are in ' +
    'staff_schedule. Read-only, one request per call.',
  input: {
    date: schema.date('Any day in the week to read. The current week when left out').optional(),
    fresh: schema.fresh,
  },
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
  description:
    'Asks Booksy how many clients a campaign would reach and what the SMS part would cost, for a ' +
    'given audience and text. It only calculates: no message is sent and nothing is saved, so it ' +
    'works with write tools off. Use it before campaign_send, which is the write tool that sends. ' +
    'The free SMS left are in campaign_sms_balance. Never cached.',
  input: {
    recipients: z
      .record(z.string(), z.unknown())
      .describe(
        'Audience object in the shape Booksy uses for campaigns. Copy it from the audience of a ' +
          'template returned by campaign_details',
      ),
    body_short: z.string().max(1000).describe('SMS text to price, at most 1000 characters'),
    channel_priority: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Channel order object as in the template from campaign_details. Leave out for the default of Booksy',
      ),
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
    'Lists the client chat conversations of the salon, most recently active first, each with its ' +
    'latest message. Use it to find a conversation and its id. chat_messages then reads the ' +
    'messages, and chat_reply is the write tool that answers. Read-only. It works only where the ' +
    'panel has client chat enabled, and one call counts as three requests against the budgets.',
  input: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(20)
      .describe('How many conversations to return, from 1 to 30. Default 20'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('How many conversations to skip, for paging: 0, then 20, then 40. Default 0'),
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
  description:
    'Returns the latest messages of one client chat conversation, with the state of the ' +
    'conversation. Use it after chat_conversations gave you the id. Older messages beyond limit ' +
    'cannot be paged. Read-only: chat_reply is the separate write tool for answering. One call ' +
    'counts as three requests against the budgets.',
  input: {
    channel_id: schema.id('Conversation id from chat_conversations'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .describe('How many of the latest messages to return, from 1 to 100. Default 30'),
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
