import { z } from 'zod';
import { BooksyError } from '../errors.js';
import { schema, type Args, type ToolContext, type ToolDef, type WritePlan, writeTool } from './define.js';

type Appointment = Record<string, unknown> & {
  appointment_uid?: unknown;
  _version?: unknown;
  subbookings?: Array<Record<string, unknown>>;
  payment_info?: {
    deposit_info?: { id?: unknown; short_status?: string } | null;
    auto_release_deposit_on_cancel?: boolean;
  };
};

const notifyCustomer = z
  .boolean()
  .describe('Whether Booksy should notify the client about this change. Required on purpose.');

async function loadAppointment(context: ToolContext, uid: string): Promise<Appointment> {
  const response = await context.gateway.request('appointment.read', {
    urlParams: { appointmentUid: uid },
    fresh: true,
  });
  const appointment = (response.data as { appointment?: Appointment }).appointment;
  if (!appointment) throw new BooksyError('booksy_error', 'Booksy returned no appointment.');
  return appointment;
}

/** The panel asks about the deposit when one is held and is not released automatically. */
function depositDecisionNeeded(appointment: Appointment): boolean {
  const payment = appointment.payment_info;
  const deposit = payment?.deposit_info;
  if (!deposit?.id || payment?.auto_release_deposit_on_cancel) return false;
  return !['canceled', 'success'].includes((deposit.short_status ?? '').toLowerCase());
}

function shift(value: unknown, minutes: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(`${value.slice(0, 16)}:00Z`);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed + minutes * 60_000).toISOString().slice(0, 16);
}

function minutesBetween(from: string, to: string): number {
  return (Date.parse(`${to.slice(0, 16)}:00Z`) - Date.parse(`${from.slice(0, 16)}:00Z`)) / 60_000;
}

const saveFlags = (notify: boolean): Record<string, boolean> => ({
  overbooking: false,
  _notification_enabled: notify,
  _notify_about_reschedule: notify,
  _update_future_bookings: false,
  _preserve_order: false,
});

async function actionPlan(
  context: ToolContext,
  uid: string,
  action: string,
  summary: string,
  extra: (appointment: Appointment) => Record<string, unknown>,
): Promise<WritePlan> {
  const appointment = await loadAppointment(context, uid);
  return {
    summary,
    ruleId: 'appointment.action',
    urlParams: { appointmentUid: uid },
    data: { action, _version: appointment._version, ...extra(appointment) },
  };
}

function releaseDeposit(appointment: Appointment, args: Args): Record<string, boolean> {
  if (!depositDecisionNeeded(appointment)) return {};
  if (typeof args.release_deposit !== 'boolean') {
    throw new BooksyError(
      'invalid_input',
      'This appointment has a deposit. Set release_deposit to true or false. This is the ' +
        "salon's decision about the client's money, so ask the user.",
    );
  }
  return { release_deposit: args.release_deposit };
}

const appointmentRef = { appointment_uid: schema.id('appointment_uid from the calendar') };
const uidOf = (args: Args): string => args.appointment_uid as string;

export const WRITE_TOOLS: ToolDef[] = [
  writeTool({
    name: 'appointment_book',
    title: 'Book an appointment',
    description:
      'Creates an appointment. The dry run asks Booksy to validate it without saving. Service ' +
      'variants come from service_menu, staff from team_resources, clients from customer_cards.',
    input: {
      customer_id: schema.id('Client id. Leave out for a walk-in').optional(),
      start: schema.dateTime('Start of the first service'),
      lines: z
        .array(
          z.object({
            service_variant_id: z.number().int().describe('Variant id from service_menu'),
            staff_id: z.number().int().describe('Staff id from team_resources'),
            minutes: z.number().int().min(5).max(720).describe('Length of this service'),
          }),
        )
        .min(1)
        .max(10)
        .describe('Services in order, one after another'),
      note: z.string().max(500).optional().describe('Internal note'),
      notify_customer: notifyCustomer,
    },
    plan(args) {
      type Line = { service_variant_id: number; staff_id: number; minutes: number };
      let cursor = args.start as string;
      const subbookings = (args.lines as Line[]).map((line) => {
        const bookedFrom = cursor;
        const bookedTill = shift(cursor, line.minutes) as string;
        cursor = bookedTill;
        return {
          booked_from: bookedFrom,
          booked_till: bookedTill,
          staffer_id: line.staff_id,
          service_variant: { mode: 'variant', id: line.service_variant_id },
        };
      });
      return {
        summary:
          `Book ${subbookings.length} service(s) from ${args.start as string}` +
          `${args.customer_id ? ` for client ${args.customer_id as string}` : ' as a walk-in'}, ` +
          `client notification ${args.notify_customer ? 'on' : 'off'}.`,
        ruleId: 'appointment.create',
        data: {
          customer: args.customer_id
            ? { mode: 'customer-card', id: Number(args.customer_id) }
            : { mode: 'walk-in' },
          subbookings,
          business_note: '',
          business_secret_note: (args.note as string | undefined) ?? '',
          dry_run: false,
          ...saveFlags(args.notify_customer as boolean),
        },
      };
    },
    async preview(plan, _args, context) {
      const response = await context.gateway.request('appointment.create_preview', {
        data: plan.data,
      });
      return response.data;
    },
  }),

  writeTool({
    name: 'appointment_move',
    title: 'Move an appointment',
    description:
      'Moves an appointment to a new start time and optionally another staff member, keeping the ' +
      'length of each service. The dry run asks Booksy to validate it.',
    input: {
      ...appointmentRef,
      new_start: schema.dateTime('New start'),
      staff_id: z.number().int().optional().describe('New staff member for all services'),
      notify_customer: notifyCustomer,
    },
    async plan(args, context) {
      const appointment = await loadAppointment(context, uidOf(args));
      const parts = appointment.subbookings ?? [];
      const first = parts[0]?.booked_from;
      if (typeof first !== 'string') {
        throw new BooksyError('booksy_error', 'The appointment has no start time.');
      }
      const delta = minutesBetween(first, args.new_start as string);
      const subbookings = parts.map((part) => ({
        ...part,
        booked_from: shift(part.booked_from, delta),
        booked_till: shift(part.booked_till, delta),
        ...(args.staff_id === undefined ? {} : { staffer_id: args.staff_id }),
      }));
      return {
        summary:
          `Move appointment ${uidOf(args)} from ${first.slice(0, 16)} to ${args.new_start as string}, ` +
          `client notification ${args.notify_customer ? 'on' : 'off'}.`,
        ruleId: 'appointment.update',
        urlParams: { appointmentUid: uidOf(args) },
        data: { ...appointment, subbookings, ...saveFlags(args.notify_customer as boolean) },
      };
    },
    async preview(plan, _args, context) {
      const response = await context.gateway.request('appointment.update_preview', {
        urlParams: plan.urlParams as Record<string, string>,
        data: plan.data,
      });
      return response.data;
    },
  }),

  writeTool({
    name: 'appointment_cancel',
    title: 'Cancel an appointment',
    description: 'Cancels an appointment. Choose separately whether the client gets an e-mail or SMS.',
    input: {
      ...appointmentRef,
      notify_by_email: z.boolean().describe('Tell the client by e-mail'),
      notify_by_sms: z.boolean().describe('Tell the client by SMS'),
      note: z.string().max(500).optional().describe('Reason shown on the appointment'),
      release_deposit: z.boolean().optional().describe('Needed when a deposit is held'),
    },
    plan: (args, context) =>
      actionPlan(
        context,
        uidOf(args),
        'cancel',
        `Cancel appointment ${uidOf(args)}. E-mail ${args.notify_by_email ? 'on' : 'off'}, ` +
          `SMS ${args.notify_by_sms ? 'on' : 'off'}.`,
        (appointment) => ({
          _notify_about_cancel_email: args.notify_by_email,
          _notify_about_cancel_sms: args.notify_by_sms,
          business_note: args.note ?? '',
          _update_future_bookings: false,
          ...releaseDeposit(appointment, args),
        }),
      ),
  }),

  writeTool({
    name: 'appointment_confirm',
    title: 'Confirm a booking request',
    description: 'Accepts a booking request that waits for the salon.',
    input: appointmentRef,
    plan: (args, context) =>
      actionPlan(context, uidOf(args), 'confirm', `Confirm booking request ${uidOf(args)}.`, () => ({
        _update_future_bookings: true,
      })),
  }),

  writeTool({
    name: 'appointment_decline',
    title: 'Decline a booking request',
    description: 'Declines a booking request that waits for the salon.',
    input: { ...appointmentRef, release_deposit: z.boolean().optional() },
    plan: (args, context) =>
      actionPlan(context, uidOf(args), 'decline', `Decline booking request ${uidOf(args)}.`, (a) => ({
        _update_future_bookings: true,
        ...releaseDeposit(a, args),
      })),
  }),

  writeTool({
    name: 'appointment_mark_no_show',
    title: 'Mark as no-show',
    description: 'Marks an appointment as a no-show.',
    input: {
      ...appointmentRef,
      notify_customer: notifyCustomer,
      release_deposit: z.boolean().optional().describe('Needed when a deposit is held'),
    },
    plan: (args, context) =>
      actionPlan(context, uidOf(args), 'no_show', `Mark ${uidOf(args)} as a no-show.`, (a) => ({
        _notify_about_no_show: args.notify_customer,
        _update_future_bookings: true,
        ...releaseDeposit(a, args),
      })),
  }),

  writeTool({
    name: 'time_off_add',
    title: 'Add time off',
    description: 'Adds time off for staff members. Reason codes come from time_off_entries.',
    input: {
      resource_ids: z.array(z.number().int()).min(1).describe('Staff ids'),
      start_date: schema.date('First day'),
      end_date: schema.date('Last day'),
      reason_code: z.string().min(1).max(30).describe('Reason code'),
      all_day: z.boolean().default(true).describe('Whole days'),
      hour_from: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('HH:mm, when not all day'),
      hour_till: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('HH:mm, when not all day'),
    },
    plan: (args) => ({
      summary:
        `Add time off (${args.reason_code as string}) from ${args.start_date as string} to ` +
        `${args.end_date as string} for ${(args.resource_ids as number[]).length} staff member(s).`,
      ruleId: 'time_off.add',
      data: {
        id: null,
        approved: true,
        resource_ids: args.resource_ids,
        start_date: args.start_date,
        end_date: args.end_date,
        reason_code: args.reason_code,
        all_day: args.all_day,
        ...(args.hour_from ? { hour_from: args.hour_from } : {}),
        ...(args.hour_till ? { hour_till: args.hour_till } : {}),
      },
    }),
  }),

  writeTool({
    name: 'time_off_remove',
    title: 'Remove time off',
    description: 'Removes one time off entry.',
    input: {
      resourceId: schema.id('Staff id'),
      timeOffId: schema.id('Time off id from time_off_entries'),
    },
    plan: (args) => ({
      summary: `Remove time off ${args.timeOffId as string} of staff ${args.resourceId as string}.`,
      ruleId: 'time_off.remove',
      urlParams: {
        resourceId: args.resourceId as string,
        timeOffId: args.timeOffId as string,
      },
    }),
  }),

  writeTool({
    name: 'time_block_add',
    title: 'Block time in the calendar',
    description: 'Blocks a part of the calendar for staff or stations, without a client.',
    input: {
      from: schema.dateTime('Start'),
      till: schema.dateTime('End'),
      resources: z.array(z.number().int()).min(1).describe('Staff or station ids'),
      reason: z.string().max(200).default('').describe('Reason shown in the calendar'),
    },
    plan: (args) => ({
      summary: `Block ${args.from as string} to ${args.till as string}.`,
      ruleId: 'reservation.create',
      data: {
        reserved_from: args.from,
        reserved_till: args.till,
        resources: args.resources,
        reason: args.reason,
        overbooking: false,
      },
    }),
  }),

  writeTool({
    name: 'time_block_remove',
    title: 'Remove a time block',
    description: 'Removes a calendar time block.',
    input: { reservationId: schema.id('Time block id') },
    plan: (args) => ({
      summary: `Remove time block ${args.reservationId as string}.`,
      ruleId: 'reservation.remove',
      urlParams: { reservationId: args.reservationId as string },
    }),
  }),

  writeTool({
    name: 'customer_add',
    title: 'Add a client',
    description: 'Adds a client card. Never sends an invitation.',
    input: {
      first_name: z.string().min(1).max(100),
      last_name: z.string().max(100).default(''),
      cell_phone: z.string().max(30).optional(),
      email: z.string().email().optional(),
      business_secret_note: z.string().max(2000).optional().describe('Internal note'),
    },
    plan: (args) => ({
      summary: `Add client card for ${args.first_name as string} ${args.last_name as string}.`,
      ruleId: 'customers.create',
      data: { ...withoutControl(args), invite: false },
    }),
  }),

  writeTool({
    name: 'customer_update',
    title: 'Edit a client',
    description: 'Changes the given fields of a client card.',
    input: {
      customerId: schema.id('Client id'),
      first_name: z.string().min(1).max(100).optional(),
      last_name: z.string().max(100).optional(),
      cell_phone: z.string().max(30).optional(),
      email: z.string().email().optional(),
      birthday: z.string().max(10).optional(),
      address_line_1: z.string().max(200).optional(),
      address_line_2: z.string().max(200).optional(),
      city: z.string().max(100).optional(),
      zipcode: z.string().max(20).optional(),
    },
    plan: (args) => {
      const { customerId, ...fields } = withoutControl(args);
      if (Object.keys(fields).length === 0) {
        throw new BooksyError('invalid_input', 'Name at least one field to change.');
      }
      return {
        summary: `Update ${Object.keys(fields).join(', ')} of client ${customerId as string}.`,
        ruleId: 'customers.update',
        urlParams: { customerId: customerId as string },
        data: fields,
      };
    },
  }),

  writeTool({
    name: 'customer_note_set',
    title: 'Set the client note',
    description: 'Replaces the internal note on a client card. Clients do not see it.',
    input: {
      customerId: schema.id('Client id'),
      business_secret_note: z.string().max(2000).describe('New note'),
    },
    plan: (args) => ({
      summary: `Replace the internal note of client ${args.customerId as string}.`,
      ruleId: 'customers.update',
      urlParams: { customerId: args.customerId as string },
      data: { business_secret_note: args.business_secret_note },
    }),
  }),

  writeTool({
    name: 'customer_delete',
    title: 'Delete a client',
    description: 'Deletes a client card. This cannot be undone from here.',
    input: { customerId: schema.id('Client id') },
    plan: (args) => ({
      summary: `Delete client card ${args.customerId as string}. This cannot be undone.`,
      ruleId: 'customers.delete',
      urlParams: { customerId: args.customerId as string },
    }),
  }),

  writeTool({
    name: 'review_reply',
    title: 'Reply to a review',
    description: 'Publishes a public reply to a review.',
    input: {
      reviewId: schema.id('Review id'),
      reply_content: z.string().min(1).max(2000).describe('Reply text, public'),
    },
    plan: (args, context) => ({
      summary: `Publish a public reply to review ${args.reviewId as string}: ${args.reply_content as string}`,
      ruleId: 'reviews.reply',
      urlParams: { reviewId: args.reviewId as string },
      data: {
        reply_content: args.reply_content,
        reply_updated: context.now().toISOString().slice(0, 10),
      },
    }),
  }),

  writeTool({
    name: 'campaign_send',
    title: 'Send a campaign',
    description:
      'Sends a one-off message campaign to clients. This reaches real people and can cost money. ' +
      'The dry run shows the number of recipients and the cost.',
    outreach: true,
    input: {
      templateId: schema.id('Template id from campaign_groups'),
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(5000).describe('Full message'),
      body_short: z.string().min(1).max(1000).describe('SMS text'),
      recipients: z
        .record(z.string(), z.unknown())
        .describe('Audience. An empty audience is refused here.'),
      channel_priority: z.record(z.string(), z.unknown()).describe('Channel order'),
      with_agreements: z.boolean().default(true).describe('Only clients who agreed to marketing'),
      scheduled_date: schema.date('Send later on this day').optional(),
      date_hour: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Send later at HH:mm'),
    },
    plan(args) {
      const recipients = args.recipients as Record<string, unknown>;
      const empty = Object.values(recipients).every(
        (value) =>
          value === null ||
          value === undefined ||
          value === '' ||
          (Array.isArray(value) && value.length === 0),
      );
      if (empty) {
        throw new BooksyError(
          'invalid_input',
          'The audience is empty. Name the audience explicitly: an empty one is never sent.',
        );
      }
      return {
        summary: `Send campaign "${args.title as string}" to real clients.`,
        ruleId: 'campaigns.send',
        urlParams: { templateId: args.templateId as string },
        data: {
          title: args.title,
          body: args.body,
          body_short: args.body_short,
          recipients: { ...recipients, with_agreements: args.with_agreements },
          channel_priority: args.channel_priority,
          ...(args.scheduled_date
            ? { scheduled_date: args.scheduled_date, date_hour: args.date_hour }
            : {}),
        },
      };
    },
    async preview(_plan, args, context) {
      const response = await context.gateway.request('campaigns.estimate', {
        data: {
          ...(args.recipients as object),
          body_short: args.body_short,
          channel_priority: args.channel_priority,
        },
      });
      return response.data;
    },
  }),

  writeTool({
    name: 'chat_reply',
    title: 'Reply in a client chat',
    description: 'Sends a chat message to a client.',
    outreach: true,
    input: {
      channel_id: schema.id('Conversation id from chat_conversations'),
      text: z.string().min(1).max(2000).describe('Message text'),
    },
    plan: (args) => ({
      summary: `Send to conversation ${args.channel_id as string}: ${args.text as string}`,
      chat: {
        action: 'send',
        channelId: args.channel_id as string,
        text: args.text as string,
      },
    }),
  }),
];

function withoutControl(args: Args): Args {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([key, value]) => key !== 'mode' && key !== 'confirm_token' && value !== undefined,
    ),
  );
}
