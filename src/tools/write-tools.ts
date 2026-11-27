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
  .describe(
    'true lets Booksy notify the client about this change, false keeps it silent. Required on ' +
      'purpose and has no default: ask the user when unsure',
  );

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

const appointmentRef = {
  appointment_uid: schema.id(
    'appointment_uid of the appointment, from calendar_agenda or appointment_requests, for example 123456789',
  ),
};
const releaseDepositInput = z
  .boolean()
  .optional()
  .describe(
    'Needed only when the appointment holds a deposit that is not released automatically: true ' +
      'releases the deposit, false keeps it. The call is refused without it in that case. ' +
      "This is the salon's decision about the client's money, so ask the user",
  );
const uidOf = (args: Args): string => args.appointment_uid as string;

export const WRITE_TOOLS: ToolDef[] = [
  writeTool({
    name: 'appointment_book',
    title: 'Book an appointment',
    description:
      'Creates a new appointment for a client or a walk-in: one or more services in a row, each ' +
      'with its own staff member and length. Use it for new visits only; appointment_move changes ' +
      'the time of an existing one. Check calendar_open_slots first: overbooking is off, and the ' +
      'dry run asks Booksy to validate the visit without saving it. Service variants come from ' +
      'service_menu, staff from team_resources and clients from customer_cards.',
    input: {
      customer_id: schema
        .id('Client id from customer_cards, for example 12345. Leave out to book a walk-in without a card')
        .optional(),
      start: schema.dateTime('Start of the first service'),
      lines: z
        .array(
          z.object({
            service_variant_id: z
              .number()
              .int()
              .describe('Id of the service variant, from service_menu, for example 12345'),
            staff_id: z
              .number()
              .int()
              .describe('Id of the staff member who does this service, from team_resources'),
            minutes: z
              .number()
              .int()
              .min(5)
              .max(720)
              .describe('Length of this service in minutes, from 5 to 720, for example 45'),
          }),
        )
        .min(1)
        .max(10)
        .describe(
          'From 1 to 10 services in order. The first starts at start, and each next one starts ' +
            'when the one before ends',
        ),
      note: z
        .string()
        .max(500)
        .optional()
        .describe('Internal note for the salon, at most 500 characters. The client does not see it'),
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
      'Moves an existing appointment to a new start time and optionally to another staff member, ' +
      'keeping the length and order of each service. Use it to reschedule; to end a visit use ' +
      'appointment_cancel, and to create one use appointment_book. It reads the appointment ' +
      'fresh, and the dry run asks Booksy to validate the new time without saving it.',
    input: {
      ...appointmentRef,
      new_start: schema.dateTime('New start of the first service'),
      staff_id: z
        .number()
        .int()
        .optional()
        .describe(
          'Id from team_resources of the staff member who takes over all services of the visit. ' +
            'Staff stay as they are when left out',
        ),
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
    description:
      'Cancels an existing appointment on behalf of the salon, with a separate choice whether ' +
      'the client is told by e-mail and by SMS. Use it for accepted visits; a booking request ' +
      'that still waits for the salon is refused with appointment_decline, and a client who did ' +
      'not come is marked with appointment_mark_no_show. Cancelling cannot be undone from here.',
    input: {
      ...appointmentRef,
      notify_by_email: z
        .boolean()
        .describe('true tells the client about the cancellation by e-mail, false does not. Required'),
      notify_by_sms: z
        .boolean()
        .describe('true tells the client about the cancellation by SMS, false does not. Required'),
      note: z
        .string()
        .max(500)
        .optional()
        .describe('Reason saved as the business note of the appointment, at most 500 characters'),
      release_deposit: releaseDepositInput,
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
    description:
      'Accepts a booking request that waits for the salon (status W), so it becomes a confirmed ' +
      'appointment. Use it on entries from appointment_requests. appointment_decline refuses ' +
      'such a request, and appointment_cancel is for visits that were already accepted.',
    input: appointmentRef,
    plan: (args, context) =>
      actionPlan(context, uidOf(args), 'confirm', `Confirm booking request ${uidOf(args)}.`, () => ({
        _update_future_bookings: true,
      })),
  }),

  writeTool({
    name: 'appointment_decline',
    title: 'Decline a booking request',
    description:
      'Declines a booking request that waits for the salon (status W), so the visit does not ' +
      'take place. Use it on entries from appointment_requests. appointment_confirm accepts such ' +
      'a request, and appointment_cancel is for visits that were already accepted.',
    input: { ...appointmentRef, release_deposit: releaseDepositInput },
    plan: (args, context) =>
      actionPlan(context, uidOf(args), 'decline', `Decline booking request ${uidOf(args)}.`, (a) => ({
        _update_future_bookings: true,
        ...releaseDeposit(a, args),
      })),
  }),

  writeTool({
    name: 'appointment_mark_no_show',
    title: 'Mark as no-show',
    description:
      'Marks an appointment as a no-show: the client did not come. To call a visit off in ' +
      'advance use appointment_cancel instead. A held deposit needs an explicit release_deposit ' +
      'decision, and notify_customer decides whether the client is told.',
    input: {
      ...appointmentRef,
      notify_customer: notifyCustomer,
      release_deposit: releaseDepositInput,
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
    description:
      'Adds approved time off (holiday, sick leave and the like) for one or more staff members, ' +
      'for whole days or for hours within the days. Use it for absences of people; to block a ' +
      'single part of the calendar for staff or a station use time_block_add. Reason codes come ' +
      'from time_off_reasons in time_off_entries, and time_off_remove undoes an entry.',
    input: {
      resource_ids: z
        .array(z.number().int())
        .min(1)
        .describe('Ids of the staff members from team_resources, at least one, for example [12345]'),
      start_date: schema.date('First day of the time off'),
      end_date: schema.date('Last day of the time off, inclusive'),
      reason_code: z
        .string()
        .min(1)
        .max(30)
        .describe('Reason code of the salon, taken from time_off_reasons in time_off_entries'),
      all_day: z
        .boolean()
        .default(true)
        .describe('true for whole days, false to use hour_from and hour_till. Default true'),
      hour_from: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional()
        .describe('Start on each day as HH:mm in salon local time, for example 09:00. Only with all_day=false'),
      hour_till: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional()
        .describe('End on each day as HH:mm in salon local time, for example 13:00. Only with all_day=false'),
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
    description:
      'Removes one time off entry of one staff member, so that time counts as working time ' +
      'again. Use it to undo time_off_add or to delete an absence. Find the entry and its id ' +
      'with time_off_entries. To remove a time block use time_block_remove.',
    input: {
      resourceId: schema.id('Id of the staff member the entry belongs to: resource_id in time_off_entries'),
      timeOffId: schema.id('Id of the time off entry, from time_off_entries'),
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
    description:
      'Blocks one part of the calendar for staff members or stations without a client, for ' +
      'example a break or a meeting. Use it for a single ' +
      'stretch of time; for holidays and other absences over days use time_off_add. Overbooking ' +
      'is off, so Booksy can refuse a block over existing bookings.',
    input: {
      from: schema.dateTime('Start of the block'),
      till: schema.dateTime('End of the block'),
      resources: z
        .array(z.number().int())
        .min(1)
        .describe('Ids of the staff members or stations to block, from team_resources, for example [12345]'),
      reason: z
        .string()
        .max(200)
        .default('')
        .describe('Reason shown in the calendar, at most 200 characters. Default empty'),
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
    description:
      'Removes one calendar time block (reserved time without a client). Use it to undo ' +
      'time_block_add. Time blocks are listed under reservations in calendar_agenda, and ' +
      'time_block_details shows one. To remove time off of a staff member use time_off_remove.',
    input: {
      reservationId: schema.id(
        'Time block id: the id of an entry under reservations in calendar_agenda, for example 12345',
      ),
    },
    plan: (args) => ({
      summary: `Remove time block ${args.reservationId as string}.`,
      ruleId: 'reservation.remove',
      urlParams: { reservationId: args.reservationId as string },
    }),
  }),

  writeTool({
    name: 'customer_add',
    title: 'Add a client',
    description:
      'Adds a new client card with a name and optional phone, e-mail and internal note. Search ' +
      'customer_cards first so the client is not added twice. It never sends the client an ' +
      'invitation to Booksy. To change an existing card use customer_update.',
    input: {
      first_name: z.string().min(1).max(100).describe('First name of the client, 1 to 100 characters'),
      last_name: z
        .string()
        .max(100)
        .default('')
        .describe('Last name of the client, at most 100 characters. Default empty'),
      cell_phone: z
        .string()
        .max(30)
        .optional()
        .describe('Mobile phone number, at most 30 characters, for example +48600100200'),
      email: z.string().email().optional().describe('E-mail address of the client, for example anna@example.com'),
      business_secret_note: z
        .string()
        .max(2000)
        .optional()
        .describe('Internal note on the card, at most 2000 characters. The client does not see it'),
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
    description:
      'Changes contact and address fields of one client card. Only the fields you pass are sent, ' +
      'and at least one is required. Use customer_note_set for the internal note and ' +
      'customer_add for a new client. Read the card with customer_card first, so the dry run ' +
      'can be compared with what is there.',
    input: {
      customerId: schema.id('Client id from customer_cards, for example 12345'),
      first_name: z.string().min(1).max(100).optional().describe('New first name, 1 to 100 characters'),
      last_name: z.string().max(100).optional().describe('New last name, at most 100 characters'),
      cell_phone: z
        .string()
        .max(30)
        .optional()
        .describe('New mobile phone number, at most 30 characters, for example +48600100200'),
      email: z.string().email().optional().describe('New e-mail address, for example anna@example.com'),
      birthday: z
        .string()
        .max(10)
        .optional()
        .describe('New birthday, at most 10 characters, in the form the client card shows it'),
      address_line_1: z.string().max(200).optional().describe('New first address line, at most 200 characters'),
      address_line_2: z.string().max(200).optional().describe('New second address line, at most 200 characters'),
      city: z.string().max(100).optional().describe('New city, at most 100 characters'),
      zipcode: z.string().max(20).optional().describe('New postal code, at most 20 characters'),
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
    description:
      'Replaces the whole internal note on one client card with new text. Clients do not see ' +
      'this note. It overwrites, it does not append: read the current note with customer_card ' +
      'and include what should stay. Other fields of the card are changed with customer_update.',
    input: {
      customerId: schema.id('Client id from customer_cards, for example 12345'),
      business_secret_note: z
        .string()
        .max(2000)
        .describe('The full new note, at most 2000 characters. An empty string sends an empty note'),
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
    description:
      'Deletes one client card from the business. This is destructive and cannot be undone from ' +
      'here, so use it only when the user asked for that client by name and confirmed. To ' +
      'correct a card use customer_update instead.',
    input: { customerId: schema.id('Client id from customer_cards, for example 12345') },
    plan: (args) => ({
      summary: `Delete client card ${args.customerId as string}. This cannot be undone.`,
      ruleId: 'customers.delete',
      urlParams: { customerId: args.customerId as string },
    }),
  }),

  writeTool({
    name: 'review_reply',
    title: 'Reply to a review',
    description:
      'Sets the reply of the salon under one review. ' +
      'The reply is public on the Booksy profile, so show the exact text to the user first. ' +
      'Reviews and their ids are in reviews_feed. This is not a private message to the client: ' +
      'for that use chat_reply.',
    input: {
      reviewId: schema.id('Review id from reviews_feed, for example 12345'),
      reply_content: z
        .string()
        .min(1)
        .max(2000)
        .describe('Text of the public reply, 1 to 2000 characters'),
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
      'Sends or schedules a one-off message campaign from a template to an audience of clients. ' +
      'This reaches real people and can cost money for SMS, and it cannot be recalled from ' +
      'here. The dry run asks Booksy for the number of recipients and the cost, and an empty ' +
      'audience is refused. To only price a campaign use campaign_estimate, and for one client ' +
      'use chat_reply.',
    outreach: true,
    input: {
      templateId: schema.id('Campaign template id from campaign_groups, for example 12345'),
      title: z.string().min(1).max(200).describe('Title of the campaign, 1 to 200 characters'),
      body: z.string().min(1).max(5000).describe('Full message text, 1 to 5000 characters'),
      body_short: z.string().min(1).max(1000).describe('Short text used for SMS, 1 to 1000 characters'),
      recipients: z
        .record(z.string(), z.unknown())
        .describe(
          'Audience object in the shape Booksy uses for campaigns, as in the template from ' +
            'campaign_details. It has to name an audience: an empty one is refused',
        ),
      channel_priority: z
        .record(z.string(), z.unknown())
        .describe('Channel order object, as in the template from campaign_details. Required'),
      with_agreements: z
        .boolean()
        .default(true)
        .describe('true sends only to clients who agreed to marketing messages. Default true'),
      scheduled_date: schema
        .date('Day to send on. Leave out to send right away. Use it together with date_hour')
        .optional(),
      date_hour: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional()
        .describe('Time to send at on scheduled_date, as HH:mm, for example 10:00. Ignored without scheduled_date'),
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
    description:
      'Sends one chat message from the salon into an existing client conversation. The client ' +
      'receives it at once and it cannot be recalled from here, so show the exact text to the ' +
      'user first. Read the conversation with chat_messages before answering. It cannot start a ' +
      'new conversation, and messages to many clients go through campaign_send.',
    outreach: true,
    input: {
      channel_id: schema.id('Conversation id from chat_conversations'),
      text: z.string().min(1).max(2000).describe('Text of the message, 1 to 2000 characters'),
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
