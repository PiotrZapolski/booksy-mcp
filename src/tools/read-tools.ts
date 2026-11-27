import { z } from 'zod';
import { readTool, schema, type ToolDef } from './define.js';

const paging = { page: schema.page, per_page: schema.perPage };
const paged = ['page', 'per_page'];
const dates = {
  date_from: schema.date('First day of the period'),
  date_till: schema.date('Last day of the period, inclusive'),
};
const search = (where: string): z.ZodOptional<z.ZodString> =>
  z
    .string()
    .max(100)
    .optional()
    .describe(`Search text passed to Booksy to narrow ${where}, at most 100 characters. Leave out for all`);

const ids = {
  appointment: (name: string) =>
    schema.id(`${name} of the appointment, the appointment_uid from calendar_agenda, for example 123456789`),
  resource: schema.id('Staff member or station id from team_resources, for example 12345'),
  customer: schema.id('Client id from customer_cards, for example 12345'),
  register: schema.id('Cash register id from cash_registers, for example 123'),
  transaction: schema.id('Transaction id from checkout_transactions, for example 12345'),
  warehouse: schema.id('Warehouse id from warehouses, for example 123'),
};

/** The panel names every resource in this request, so without a choice all of them are read. */
const calendarMonth: ToolDef = {
  name: 'calendar_month',
  title: 'Calendar month view',
  description:
    "Returns the panel's month view between two dates: Booksy's counters and bookings for the chosen " +
    'staff members and stations. Use it for a month at a glance; for full appointment records with ' +
    'status and staff filters use calendar_agenda. Without resource_ids it first reads the team list ' +
    'and asks for every resource, which costs one more request. Read-only: the answer is under ' +
    'data, next to business_id and from_cache.',
  input: {
    start_date: schema.date('First day of the month view'),
    end_date: schema.date('Last day of the month view'),
    resource_ids: z
      .array(schema.id('Staff member or station id from team_resources, for example 12345'))
      .max(100)
      .optional()
      .describe(
        'Only these staff member or station ids from team_resources, at most 100. All of them when left out',
      ),
    fresh: schema.fresh,
  },
  write: false,
  async handler(args, context) {
    const fresh = args.fresh === true;
    let ids = args.resource_ids as string[] | undefined;
    if (!ids) {
      const team = await context.gateway.request('resources.list', { fresh });
      const list = (team.data as { resources?: Array<{ id?: string | number }> }).resources ?? [];
      ids = list.flatMap((resource) => (resource.id === undefined ? [] : [String(resource.id)]));
    }
    const response = await context.gateway.request('calendar.month', {
      params: {
        start_date: args.start_date as string,
        end_date: args.end_date as string,
        include_unconfirmed: true,
        version: 3,
        resources_per_page: 100,
        ...(ids.length > 0 ? { resource_id: ids } : {}),
      },
      fresh,
    });
    return { business_id: response.businessId, from_cache: response.fromCache, data: response.data };
  },
};

/** Tools that map one to one onto an allowed endpoint. */
export const READ_TOOLS: ToolDef[] = [
  // Business
  readTool({
    name: 'business_accounts',
    title: 'Businesses on this login',
    description:
      'Lists every business (salon or location) the logged-in Booksy Biz user can open in the ' +
      'panel. Use it to see which accounts exist. Every other tool works only on the business open ' +
      'in the panel tab, which session_status names, and no tool can switch it.',
    rule: 'business.list',
  }),
  readTool({
    name: 'business_profile',
    title: 'Business profile',
    description:
      'Returns the public profile and core data of the business open in the panel tab, as Booksy ' +
      'stores them. Use it for facts about the salon itself. Opening hours are in opening_hours, ' +
      'the team in team_resources and the services in service_menu.',
    rule: 'business.read',
  }),
  readTool({
    name: 'business_visibility',
    title: 'Marketplace visibility',
    description:
      'Shows whether the business is visible and bookable on the Booksy marketplace. Use it when ' +
      'clients cannot find or book the salon online. The profile content itself is in ' +
      'business_profile, and booking rules are in business_booking_rules.',
    rule: 'business.visibility',
  }),
  readTool({
    name: 'business_amenities',
    title: 'Amenities',
    description:
      'Lists the amenities shown on the public profile of the business. Use it only for amenity ' +
      'questions. The rest of the profile is in business_profile, and visibility on the ' +
      'marketplace in business_visibility.',
    rule: 'business.amenities',
  }),
  readTool({
    name: 'business_features',
    title: 'Feature status',
    description:
      'Shows which panel features are on, off or available for this business. Use it to check ' +
      'whether a feature exists on this plan before calling a tool that depends on it, for example ' +
      'before the voucher, loyalty or warehouse tools.',
    rule: 'business.features',
  }),
  readTool({
    name: 'business_booking_rules',
    title: 'Booking and safety rules',
    description:
      'Returns the booking rules set in the panel, grouped by category. Use it for questions about ' +
      'how clients may book or cancel. Deposits and cancellation fees per service are in ' +
      'business_no_show_protection, and online booking channels in business_integrations.',
    rule: 'business.safety_rules',
  }),
  readTool({
    name: 'business_integrations',
    title: 'Online booking integrations',
    description:
      'Lists the online booking integrations of the business and the state of each. Use it to see ' +
      'which outside booking channels are connected. Visibility on the Booksy marketplace itself ' +
      'is in business_visibility.',
    rule: 'business.integrations',
  }),
  readTool({
    name: 'business_notification_settings',
    title: 'Notification settings',
    description:
      'Returns the notification settings for staff and the owner: which internal notices the ' +
      'business has switched on. These are settings, not messages. The notices themselves are in ' +
      'panel_notifications, and messages to clients are in the campaign tools.',
    rule: 'business.internal_notifications',
  }),
  readTool({
    name: 'business_pos_settings',
    title: 'Checkout settings',
    description:
      'Returns the checkout (point of sale) and payment settings of the business. Use it for how ' +
      'the salon takes payments. Actual payments are in payment_rows and checkout_transactions, ' +
      'and deposit rules per service in business_no_show_protection.',
    rule: 'business.pos_settings',
  }),
  readTool({
    name: 'business_no_show_protection',
    title: 'No-show protection',
    description:
      'Returns the deposit and cancellation fee settings per service (no-show protection). Use it ' +
      'to see which services need a prepayment or carry a fee. The deposit held for one ' +
      'appointment is in appointment_payment_details.',
    rule: 'business.no_show_protection',
  }),

  // Calendar
  calendarMonth,
  readTool({
    name: 'calendar_changed_dates',
    title: 'Dates changed since',
    description:
      'Lists the dates whose calendar changed since a Unix timestamp, the same check the panel ' +
      'polls with. Use it as a cheap test of which days to read again with calendar_agenda. For ' +
      'what changed in each appointment use appointment_changes_feed. This answer is never cached.',
    rule: 'calendar.changed_dates',
    input: {
      timestamp: schema.id(
        'Unix time in seconds, for example 1767225600. Dates changed after this moment are listed',
      ),
    },
    path: ['timestamp'],
  }),
  readTool({
    name: 'appointment_details',
    title: 'Appointment details',
    description:
      'Returns one appointment by its appointment_uid: its services (subbookings with booked_from ' +
      'and booked_till in salon local time), staff, client, price and payment_info. Use it once ' +
      'calendar_agenda or customer_visit_history gave you the uid. Payment, tip and refund records ' +
      'are in appointment_payment_details.',
    rule: 'appointment.read',
    input: { appointmentUid: ids.appointment('appointment_uid') },
    path: ['appointmentUid'],
  }),
  readTool({
    name: 'appointment_payment_details',
    title: 'Appointment payment',
    description:
      'Returns the deposit, payment, tip and refund state of one appointment. Use it for money ' +
      'questions about a single visit. The visit itself is in appointment_details, and payments of ' +
      'a whole period are in payment_rows.',
    rule: 'appointment.payment',
    input: { appointmentId: ids.appointment('Id') },
    path: ['appointmentId'],
  }),

  // Staff and stations
  readTool({
    name: 'resource_details',
    title: 'Staff member or station',
    description:
      'Returns one staff member or station by id. Booksy keeps both as resources. Use it for the ' +
      'details of a single resource. team_resources lists all of them with their ids, and ' +
      'staff_schedule has working hours.',
    rule: 'resources.read',
    input: { resourceId: ids.resource },
    path: ['resourceId'],
  }),
  readTool({
    name: 'resource_upcoming_bookings',
    title: 'Upcoming bookings of a resource',
    description:
      'Returns the next bookings of one staff member or station, as Booksy lists them. Use it for ' +
      'a quick look at what comes next for one resource. For a chosen date range, or for the whole ' +
      'team, use calendar_agenda with staff_id.',
    rule: 'resources.upcoming',
    input: { resourceId: ids.resource },
    path: ['resourceId'],
  }),
  readTool({
    name: 'time_block_details',
    title: 'Time block',
    description:
      'Returns one calendar time block: reserved time without a client, such as a break, with its ' +
      'start and end. Use it for a single block. calendar_agenda lists the blocks of a date range ' +
      'under reservations, and staff time off is in time_off_entries.',
    rule: 'reservation.read',
    input: {
      reservationId: schema.id(
        'Time block id: the id of an entry under reservations in calendar_agenda, for example 12345',
      ),
    },
    path: ['reservationId'],
  }),

  // Services
  readTool({
    name: 'service_menu',
    title: 'Service menu',
    description:
      'Returns the whole service menu in one answer: every category with its services, variants, ' +
      'prices and durations, combo services included. Start here to find a service or the variant ' +
      'id that appointment_book needs. service_details adds the staff assigned to one service, and ' +
      'service_addons lists add-ons.',
    rule: 'services.categories',
    fixed: { with_combos: true },
  }),
  readTool({
    name: 'service_details',
    title: 'Service details',
    description:
      'Returns one service with its variants and the staff assigned to it. Use it to check who ' +
      'performs a service or how its variants differ. For the full list of services and their ids ' +
      'use service_menu.',
    rule: 'services.read',
    input: { serviceId: schema.id('Service id from service_menu, for example 12345') },
    path: ['serviceId'],
  }),
  readTool({
    name: 'service_addons',
    title: 'Service add-ons',
    description:
      'Lists the add-ons that can be sold together with services, one page per call. Use it for ' +
      'extras attached to a visit. The services themselves are in service_menu, and retail ' +
      'products are in product_catalog.',
    rule: 'services.addons',
    input: paging,
    query: paged,
  }),

  // Clients
  readTool({
    name: 'customer_cards',
    title: 'Client cards',
    description:
      'Lists client cards in compact form, one page per call, or searches them by name, phone or ' +
      'e-mail with query. Use it to find a client and the client id. customer_card then returns ' +
      'the full card. The answer is personal data: read only the pages the task needs.',
    rule: 'customers.list',
    input: {
      ...paging,
      query: z
        .string()
        .max(100)
        .optional()
        .describe('Name, phone or e-mail to search for, for example "Kowalska". All clients when left out'),
    },
    query: [...paged, 'query'],
    fixed: { compact: true },
  }),
  readTool({
    name: 'customer_card',
    title: 'Client card',
    description:
      'Returns the full card of one client: contact data, notes, tags, and visit and spending ' +
      'counters. Use it after customer_cards gave you the id. The visits themselves are in ' +
      'customer_visit_history and the products bought in customer_product_history.',
    rule: 'customers.read',
    input: { customerId: ids.customer },
    path: ['customerId'],
  }),
  readTool({
    name: 'customer_visit_history',
    title: 'Client visit history',
    description:
      'Lists the past and future appointments of one client, one page per call. Use it for the ' +
      'history of a single client. For everyone in a date range use calendar_agenda, and for one ' +
      'visit in full use appointment_details.',
    rule: 'customers.bookings',
    input: {
      customerId: ids.customer,
      ...paging,
      state: z
        .string()
        .max(30)
        .optional()
        .describe(
          'Only visits in this state. Passed to Booksy unchanged, and the accepted values are not ' +
            'documented, so leave it out unless you know one',
        ),
      include_extra_bookings: z
        .boolean()
        .optional()
        .describe(
          'true also asks for visits outside the main list, as the panel can. Leave out for the panel default',
        ),
    },
    path: ['customerId'],
    query: [...paged, 'state'],
    // The panel really does send this name, with the letters swapped.
    map: (args) => ({ inlcude_extra_bookings: args.include_extra_bookings as boolean | undefined }),
  }),
  readTool({
    name: 'customer_product_history',
    title: 'Client product purchases',
    description:
      'Lists the retail products one client bought, one page per call. Use it for product ' +
      'purchases only. Visits and services are in customer_visit_history. Note that this tool ' +
      'pages with page_size, not per_page.',
    rule: 'customers.products',
    input: {
      customerId: ids.customer,
      page: schema.page,
      page_size: schema.perPage,
    },
    path: ['customerId'],
    query: ['page', 'page_size'],
  }),
  readTool({
    name: 'customer_groups',
    title: 'Client groups',
    description:
      'Lists the client groups of the business with the size of each. Use it to size an audience ' +
      'before a campaign. The members of a group are not listed here: find clients with ' +
      'customer_cards. Free-form labels on cards are in customer_tags.',
    rule: 'customers.groups',
  }),
  readTool({
    name: 'customer_tags',
    title: 'Client tags',
    description:
      'Lists the tags the business uses on client cards. Use it to learn which labels exist. The ' +
      'tags of one client are on customer_card, and groups with their sizes are in customer_groups.',
    rule: 'customers.tags',
  }),

  // Campaigns
  readTool({
    name: 'campaign_groups',
    title: 'Campaigns',
    description:
      'Lists all message campaign templates, including automated campaigns and their ' +
      'automated_status. Use it to find a template id for campaign_details or campaign_send. What ' +
      'is already queued to go out is in campaign_schedule.',
    rule: 'campaigns.groups',
  }),
  readTool({
    name: 'campaign_details',
    title: 'Campaign details',
    description:
      'Returns one campaign template: its text, channel, audience and automation settings. Use it ' +
      'to read a campaign before estimating or sending it. The list of templates and their ids is ' +
      'in campaign_groups.',
    rule: 'campaigns.read',
    input: { templateId: schema.id('Campaign template id from campaign_groups, for example 12345') },
    path: ['templateId'],
  }),
  readTool({
    name: 'campaign_schedule',
    title: 'Scheduled campaigns',
    description:
      'Lists the campaigns already scheduled to go out. Use it to check what clients will receive ' +
      'and when, for example before sending another campaign. Templates that are not scheduled are ' +
      'in campaign_groups.',
    rule: 'campaigns.scheduled',
  }),
  readTool({
    name: 'campaign_sms_balance',
    title: 'SMS balance',
    description:
      'Returns the SMS limits of the business, the used and free messages, and the price per SMS ' +
      'part. Use it before a campaign to see whether the free messages cover it. The cost of one ' +
      'specific campaign comes from campaign_estimate.',
    rule: 'campaigns.sms_balance',
  }),

  // Chat
  readTool({
    name: 'chat_quick_actions',
    title: 'Chat quick actions',
    description:
      'Returns the quick actions Booksy suggests for the chat with one client. It reads metadata ' +
      'only, no messages. Conversations are listed by chat_conversations and their messages by ' +
      'chat_messages.',
    rule: 'chat.actions',
    input: { bci_id: ids.customer },
    query: ['bci_id'],
  }),

  // Reviews
  readTool({
    name: 'reviews_feed',
    title: 'Reviews',
    description:
      'Lists the reviews of the business with their star ratings and the replies of the salon, ' +
      'one page per call. Use reviews_rank to read one rating only, for example 1 for the worst. ' +
      'Replying is a separate write tool, review_reply.',
    rule: 'reviews.list',
    input: {
      reviews_page: schema.page,
      reviews_per_page: schema.perPage,
      reviews_rank: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe('Only reviews with this star rating, from 1 to 5. All ratings when left out'),
      ordering: z
        .string()
        .max(20)
        .optional()
        .describe(
          'Sort key passed to Booksy unchanged. The accepted values are not documented, so leave ' +
            'it out for the default order of the panel',
        ),
    },
    query: ['reviews_page', 'reviews_per_page', 'reviews_rank', 'ordering'],
  }),

  // Payments
  readTool({
    name: 'payment_rows',
    title: 'Payment rows',
    description:
      'Lists payments between two dates with method, status and amounts, like the payments screen ' +
      'of the panel, one page per call. Use it to go through payments one by one. Totals of a ' +
      'period are in payment_summary, and checkout transactions with their items in ' +
      'checkout_transactions.',
    rule: 'payments.rows',
    input: { ...paging, ...dates, query: search('the payments') },
    query: [...paged, 'date_from', 'date_till', 'query'],
  }),
  readTool({
    name: 'payment_summary',
    title: 'Payment summary',
    description:
      'Returns the summary tiles of the panel payments screen for a period: totals instead of ' +
      'single payments. Use it for a quick figure. The payments behind it are in payment_rows, and ' +
      'revenue statistics are in stats_overview and stats_dashboard.',
    rule: 'payments.summary',
    input: {
      ...paging,
      scope: z
        .string()
        .max(30)
        .describe(
          'Period key the panel sends with this request. Required and passed to Booksy unchanged; ' +
            'the accepted values are not documented here',
        ),
      date_from: dates.date_from.optional(),
      date_till: dates.date_till.optional(),
      query: search('the payments'),
    },
    query: [...paged, 'scope', 'date_from', 'date_till', 'query'],
  }),
  readTool({
    name: 'checkout_transactions',
    title: 'Checkout transactions',
    description:
      'Lists checkout (point of sale) transactions, one page per call, optionally from a given ' +
      'day on. Use it to find a transaction id. checkout_transaction then returns one with its ' +
      'items. For payments by method and status use payment_rows.',
    rule: 'payments.transactions',
    input: {
      ...paging,
      date_from: schema.date('Only transactions from this day on').optional(),
      query: search('the transactions'),
    },
    query: [...paged, 'date_from', 'query'],
  }),
  readTool({
    name: 'checkout_transaction',
    title: 'Checkout transaction',
    description:
      'Returns one checkout transaction with its items, payments, tips and discounts. Use it after ' +
      'checkout_transactions gave you the id. Its printed form is in checkout_last_receipt.',
    rule: 'payments.transaction',
    input: { transactionId: ids.transaction },
    path: ['transactionId'],
  }),
  readTool({
    name: 'checkout_last_receipt',
    title: 'Last receipt',
    description:
      'Returns the latest receipt issued for one checkout transaction. Use it when the question ' +
      'is about the receipt itself. The items and payments of the transaction are in ' +
      'checkout_transaction, and invoices are in invoices.',
    rule: 'payments.receipt',
    input: { transactionId: ids.transaction },
    path: ['transactionId'],
  }),
  readTool({
    name: 'booking_charges',
    title: 'Booking charges',
    description:
      'Lists appointments that wait for checkout or carry booking charges, one page per call, ' +
      'optionally from a given day on. Use it to find visits that are not settled yet. Finished ' +
      'payments are in payment_rows, and the money state of one visit in appointment_payment_details.',
    rule: 'payments.booking_charges',
    input: {
      ...paging,
      date_from: schema.date('Only appointments from this day on').optional(),
      query: search('the appointments'),
    },
    query: [...paged, 'date_from', 'query'],
  }),
  readTool({
    name: 'payment_basket',
    title: 'Payment basket',
    description:
      'Returns one payment basket with its deposit, payment and refund records. Use it to follow ' +
      'the money of one sale step by step. The basket payment ids inside it are what ' +
      'refund_fee_preview needs.',
    rule: 'payments.basket',
    input: {
      basketId: schema.id('Basket id as it appears in the payment records of Booksy, for example 12345'),
    },
    path: ['basketId'],
  }),
  readTool({
    name: 'refund_fee_preview',
    title: 'Refund fees',
    description:
      'Returns the fees that would apply to refunding one basket payment. It only calculates: ' +
      'nothing is refunded, and this server has no tool that refunds. Use it to tell the user the ' +
      'cost of a refund they would make in the panel.',
    rule: 'payments.refund_fees',
    input: {
      basketPaymentId: schema.id('Basket payment id from payment_basket, for example 12345'),
    },
    path: ['basketPaymentId'],
  }),
  readTool({
    name: 'wallet_overview',
    title: 'Wallet overview',
    description:
      'Returns the balance and the overview from the financial center of Booksy payments. Use it ' +
      'for what the business currently holds. Past transfers to the bank are in wallet_payouts, ' +
      'and single payments in payment_rows.',
    rule: 'payments.wallet_overview',
  }),
  readTool({
    name: 'wallet_payouts',
    title: 'Payouts',
    description:
      'Lists the payout history of the Booksy wallet, one page per call. Use it to check when ' +
      'money was paid out and how much. The current balance is in wallet_overview. This server ' +
      'cannot start a payout.',
    rule: 'payments.wallet_payouts',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'cash_registers',
    title: 'Cash registers',
    description:
      'Lists the cash registers of the business and whether each is open or closed, one page per ' +
      'call. Use it to find a register id. cash_register returns one with totals, and ' +
      'cash_register_operations lists its cash movements.',
    rule: 'registers.list',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'cash_register',
    title: 'Cash register',
    description:
      'Returns one cash register with its totals. Use it after cash_registers gave you the id. ' +
      'Single cash in and out entries are in cash_register_operations, and the register report as ' +
      'a file comes from document_download with kind=cash_register_report.',
    rule: 'registers.read',
    input: { registerId: ids.register },
    path: ['registerId'],
  }),
  readTool({
    name: 'cash_register_operations',
    title: 'Cash register operations',
    description:
      'Lists the cash in and cash out operations of one register, one page per call. Use it to ' +
      'explain how the register total came about. The totals themselves are in cash_register.',
    rule: 'registers.operations',
    input: { registerId: ids.register, ...paging },
    path: ['registerId'],
    query: paged,
  }),
  readTool({
    name: 'invoices',
    title: 'Invoices',
    description:
      'Lists the invoices issued in the panel, one page per call. Use it to find an invoice id. ' +
      'invoice returns one in full, and document_download with kind=invoice_pdf saves its PDF.',
    rule: 'invoices.list',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'invoice',
    title: 'Invoice',
    description:
      'Returns one invoice issued in the panel, as data. Use it after invoices gave you the id. ' +
      'For the PDF file use document_download with kind=invoice_pdf, and for receipts use ' +
      'checkout_last_receipt.',
    rule: 'invoices.read',
    input: { invoiceId: schema.id('Invoice id from invoices, for example 12345') },
    path: ['invoiceId'],
  }),

  // Products and warehouse
  readTool({
    name: 'product_catalog',
    title: 'Products',
    description:
      'Lists the retail and stock products of the business with stock levels and prices, one page ' +
      'per call, optionally filtered by search text or category. Use it to find a product and its ' +
      'id. Stock movements of one product are in product_stock_history, and services are in ' +
      'service_menu, not here.',
    rule: 'warehouse.commodities',
    input: {
      ...paging,
      query: search('the products'),
      category: z
        .string()
        .max(40)
        .optional()
        .describe('Only products in this category: a category id from product_categories. All when left out'),
    },
    query: [...paged, 'query', 'category'],
  }),
  readTool({
    name: 'product_stock_history',
    title: 'Product stock history',
    description:
      'Lists the stock movements of one product in one warehouse, one page per call. Use it to ' +
      'explain how the stock level of a product changed. Current stock is in product_catalog, and ' +
      'the documents behind the movements in warehouse_documents.',
    rule: 'warehouse.history',
    input: {
      commodityId: schema.id('Product id from product_catalog, for example 12345'),
      warehouseId: ids.warehouse,
      ...paging,
    },
    path: ['commodityId', 'warehouseId'],
    query: paged,
  }),
  readTool({
    name: 'warehouses',
    title: 'Warehouses',
    description:
      'Lists the warehouses (stock locations) of the business. Use it to get a warehouse id for ' +
      'warehouse_details or product_stock_history. Products and their stock are in product_catalog.',
    rule: 'warehouse.list',
  }),
  readTool({
    name: 'warehouse_details',
    title: 'Warehouse',
    description:
      'Returns one warehouse (stock location) by id. Use it for the details of a single warehouse ' +
      'after warehouses gave you the id. Products and their stock are in product_catalog.',
    rule: 'warehouse.detail',
    input: { warehouseId: ids.warehouse },
    path: ['warehouseId'],
  }),
  readTool({
    name: 'warehouse_documents',
    title: 'Warehouse documents',
    description:
      'Lists stock documents such as deliveries and internal use, one page per call. Use it to ' +
      'find the document behind a stock change. warehouse_document returns one in full, and the ' +
      'movements of a single product are in product_stock_history.',
    rule: 'warehouse.documents',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'warehouse_document',
    title: 'Warehouse document',
    description:
      'Returns one stock document, such as a delivery or an internal use record, by id. Use it ' +
      'after warehouse_documents gave you the id. It is data, not a file: this server does not ' +
      'download stock documents.',
    rule: 'warehouse.document',
    input: { documentId: schema.id('Stock document id from warehouse_documents, for example 12345') },
    path: ['documentId'],
  }),
  readTool({
    name: 'product_brands',
    title: 'Product brands',
    description:
      'Lists the product brands defined in the warehouse of the business. Use it to see which ' +
      'brands exist. The products themselves are in product_catalog, their categories in ' +
      'product_categories and their suppliers in product_suppliers.',
    rule: 'warehouse.brands',
  }),
  readTool({
    name: 'product_categories',
    title: 'Product categories',
    description:
      'Returns the product category tree of the warehouse: categories with their subcategories. ' +
      'Use it to get a category id for the category filter of product_catalog. Service categories ' +
      'are a different list, in service_menu.',
    rule: 'warehouse.category_tree',
  }),
  readTool({
    name: 'product_suppliers',
    title: 'Suppliers',
    description:
      'Lists the suppliers the business has saved for its products, as kept in the warehouse ' +
      'module. Use it to see who the products are ordered from. Products are in product_catalog ' +
      'and brands in product_brands. Takes no filters and returns what Booksy sends for the list.',
    rule: 'warehouse.suppliers',
  }),

  // Other
  readTool({
    name: 'panel_notifications',
    title: 'Panel notifications',
    description:
      'Lists the notices from the bell of the panel, one page per call: new, active or archived ' +
      'ones. Use it to see what Booksy told the business. It marks nothing as read. Which notices ' +
      'are switched on is in business_notification_settings.',
    rule: 'notifications.list',
    input: {
      status: z
        .enum(['new', 'active', 'archived'])
        .default('active')
        .describe('Which list of the bell to read: new, active or archived. Default active'),
      ...paging,
    },
    path: ['status'],
    query: paged,
  }),
  readTool({
    name: 'vouchers',
    title: 'Vouchers',
    description:
      'Lists the vouchers, gift cards and packages the business has sold, one page per call: the ' +
      'items clients hold. For the purchases that created them use voucher_orders, and for the ' +
      'offers a client can buy use voucher_templates.',
    rule: 'vouchers.list',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'voucher_orders',
    title: 'Voucher orders',
    description:
      'Lists voucher orders, one page per call: the purchases of vouchers, gift cards and ' +
      'packages, as Booksy records them. Use it to check whether and when something was bought. ' +
      'The sold vouchers themselves are in vouchers, and the offers that can be bought in ' +
      'voucher_templates.',
    rule: 'vouchers.orders',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'voucher_templates',
    title: 'Voucher templates',
    description:
      'Lists the voucher templates of the business in one answer: the voucher, gift card and ' +
      'package offers the salon has set up for sale. Use it to see what can be bought. What was ' +
      'actually bought is in voucher_orders, and the sold items in vouchers.',
    rule: 'vouchers.templates',
  }),
  readTool({
    name: 'consent_forms',
    title: 'Consent forms',
    description:
      'Lists the consent form templates of the business: the forms clients can be asked to sign. ' +
      'Use it to see which forms exist. The consents assigned to clients are in consents_signed.',
    rule: 'consents.forms',
  }),
  readTool({
    name: 'consents_signed',
    title: 'Consents',
    description:
      'Lists the consents assigned to clients, one page per call. Use it to find the consent of a ' +
      'client. The blank forms are in consent_forms, and document_download with kind=consent_pdf ' +
      'saves one consent as a PDF.',
    rule: 'consents.list',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'waitlist',
    title: 'Waitlist',
    description:
      'Lists the clients on the waitlist of the business, one page per call. Use it to see who ' +
      'waits for a free time. Booking requests that wait for the salon to accept are a different ' +
      'list, in appointment_requests.',
    rule: 'waitlist.list',
    input: paging,
    query: paged,
  }),
  readTool({
    name: 'loyalty_program',
    title: 'Loyalty program',
    description:
      'Returns the current stamp card (loyalty) program of the business. Use it for the rules of ' +
      'the program. The cards clients hold are in loyalty_cards, and whether the feature is on ' +
      'for this business shows in business_features.',
    rule: 'loyalty.program',
  }),
  readTool({
    name: 'loyalty_cards',
    title: 'Loyalty cards',
    description:
      'Lists the loyalty (stamp) cards of clients, one page per call. Use it to see which clients ' +
      'collect stamps. The rules of the program are in loyalty_program.',
    rule: 'loyalty.cards',
    input: paging,
    query: paged,
  }),
];
