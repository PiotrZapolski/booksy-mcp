/**
 * The only requests this project can make. The server and the extension both use this file, and
 * the wire protocol carries a rule id instead of a URL. Adding an endpoint means adding it here.
 *
 * read      GET, no side effects.
 * estimate  POST the panel uses to calculate something without changing data.
 * write     Changes data. Needs tool-level enablement, a dry run and a confirmation.
 */
export type RuleKind = 'read' | 'estimate' | 'write';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Rule {
  id: string;
  method: HttpMethod;
  path: string;
  kind: RuleKind;
  binary?: boolean;
  timeoutMs?: number;
  cacheSeconds?: number;
}

const B = '/business_api/me/businesses/:businessId';
const STATS = '/business_api/me/stats/businesses/:businessId';
const WH = `${B}/warehouse`;

/** Long-running panel reports use the same 200 s limit as the panel. */
const REPORT_TIMEOUT_MS = 200_000;
const CATALOG = 300;
const STATS_CACHE = 600;

function read(id: string, path: string, extra: Partial<Rule> = {}): Rule {
  return { id, method: 'GET', path, kind: 'read', ...extra };
}

function write(id: string, method: HttpMethod, path: string): Rule {
  return { id, method, path, kind: 'write' };
}

function estimate(id: string, path: string, method: HttpMethod = 'POST'): Rule {
  return { id, method, path, kind: 'estimate' };
}

export const RULES: readonly Rule[] = [
  // Session and business
  read('business.list', '/business_api/me/businesses', { cacheSeconds: CATALOG }),
  read('business.read', B, { cacheSeconds: CATALOG }),
  read('business.visibility', `${B}/visibility/`, { cacheSeconds: CATALOG }),
  read('business.amenities', `${B}/amenities`, { cacheSeconds: CATALOG }),
  read('business.features', `${B}/features_status/`, { cacheSeconds: CATALOG }),
  read('business.safety_rules', `${B}/categorised_safety_rules`, { cacheSeconds: CATALOG }),
  read('business.integrations', `${B}/online_booking_integrations`, { cacheSeconds: CATALOG }),
  read('business.internal_notifications', `${B}/notifications/`, { cacheSeconds: CATALOG }),
  read('business.pos_settings', `${B}/pos/`, { cacheSeconds: CATALOG }),
  read('business.no_show_protection', `${B}/pos/no_show_fee_service_protection/`, {
    cacheSeconds: CATALOG,
  }),

  // Calendar and appointments
  read('calendar.range', `${B}/calendar`),
  read('calendar.month', `${B}/monthly_bookings`),
  read('calendar.changed_dates', `${B}/calendar/changed_dates/:timestamp/`, { cacheSeconds: 0 }),
  read('appointment.read', `${B}/appointments/:appointmentUid/`),
  read('appointment.payment', `${B}/payments/appointments/:appointmentId/details/`),
  estimate('appointment.create_preview', `${B}/appointments/dry_run/`),
  estimate('appointment.update_preview', `${B}/appointments/:appointmentUid/dry_run/`, 'PUT'),
  write('appointment.create', 'POST', `${B}/appointments/`),
  write('appointment.update', 'PUT', `${B}/appointments/:appointmentUid/`),
  write('appointment.action', 'POST', `${B}/appointments/:appointmentUid/action`),

  // Staff, stations, shifts
  read('resources.list', `${B}/resources`, { cacheSeconds: CATALOG }),
  read('resources.read', '/business_api/me/resources/:resourceId', { cacheSeconds: CATALOG }),
  read('resources.upcoming', `${B}/resources/:resourceId/upcoming_bookings/`),
  read('shifts.week', `${B}/shifts`),
  write('time_off.add', 'POST', `${B}/shifts/resources/time_offs`),
  write('time_off.remove', 'DELETE', `${B}/shifts/resources/:resourceId/time_offs/:timeOffId`),
  read('reservation.read', '/business_api/me/reservations/:reservationId/'),
  write('reservation.create', 'POST', `${B}/reservations/`),
  write('reservation.remove', 'DELETE', '/business_api/me/reservations/:reservationId/'),

  // Services
  read('services.categories', `${B}/service_categories`, { cacheSeconds: CATALOG }),
  read('services.read', `${B}/services/:serviceId`, { cacheSeconds: CATALOG }),
  read('services.addons', `${B}/services/addons`, { cacheSeconds: CATALOG }),

  // Clients
  read('customers.list', `${B}/customers`),
  read('customers.read', `${B}/customers/:customerId`),
  read('customers.bookings', `${B}/customers/:customerId/bookings`),
  read('customers.products', `${B}/customers/:customerId/products`),
  read('customers.groups', `${B}/customer_groups`, { cacheSeconds: CATALOG }),
  read('customers.tags', `${B}/customers/tags`, { cacheSeconds: CATALOG }),
  read('customers.file', `${B}/customers/:customerId/attached_files/:attachedFileId/download/`, {
    binary: true,
  }),
  write('customers.create', 'POST', `${B}/customers`),
  write('customers.update', 'PUT', `${B}/customers/:customerId`),
  write('customers.delete', 'DELETE', `${B}/customers/:customerId`),

  // Campaigns
  read('campaigns.groups', `${B}/message_blast/`, { cacheSeconds: CATALOG }),
  read('campaigns.read', `${B}/message_blast/:templateId/`, { cacheSeconds: CATALOG }),
  read('campaigns.scheduled', `${B}/message_blast/scheduled/`),
  read('campaigns.sms_balance', `${B}/sms/management/`),
  estimate('campaigns.estimate', `${B}/message_blast/cost_estimation/`),
  write('campaigns.send', 'POST', `${B}/message_blast/:templateId/one_time_send/`),

  // Chat. Only metadata goes through here, see the chat function in the extension.
  read('chat.actions', `${B}/stream_chat/call_to_actions/`),

  // Reviews
  read('reviews.list', `${B}/reviews/`),
  write('reviews.reply', 'PUT', `${B}/reviews/:reviewId/reply/`),

  // Statistics and reports
  read('stats.main', `${STATS}/dashboard/main`, {
    cacheSeconds: STATS_CACHE,
    timeoutMs: REPORT_TIMEOUT_MS,
  }),
  read('stats.dashboard', `${STATS}/dashboard`, {
    cacheSeconds: STATS_CACHE,
    timeoutMs: REPORT_TIMEOUT_MS,
  }),
  read('stats.report', `${STATS}/report`, {
    cacheSeconds: STATS_CACHE,
    timeoutMs: REPORT_TIMEOUT_MS,
  }),
  read('stats.section', `${STATS}/section`, {
    cacheSeconds: STATS_CACHE,
    timeoutMs: REPORT_TIMEOUT_MS,
  }),
  read('stats.metadata', `${STATS}/report/metadata`, { cacheSeconds: STATS_CACHE }),
  read('stats.download', `${STATS}/report/download`, {
    binary: true,
    cacheSeconds: 0,
    timeoutMs: REPORT_TIMEOUT_MS,
  }),
  read('stats.billing_cycles', `${B}/billing/cycles`, { cacheSeconds: CATALOG }),

  // Payments, read only
  read('payments.rows', `${B}/pos/payment_rows`),
  read('payments.summary', `${B}/pos/payment_rows_summary`),
  read('payments.transactions', `${B}/pos/transactions`),
  read('payments.transaction', `${B}/pos/transactions/:transactionId`),
  read('payments.receipt', `${B}/pos/transactions/:transactionId/last_receipt`),
  read('payments.booking_charges', `${B}/pos/booking_charges`),
  read('payments.basket', `${B}/payments/baskets/:basketId`),
  read('payments.refund_fees', `${B}/payments/basket_payment/:basketPaymentId/refund_fees/`),
  read('payments.wallet_overview', `${B}/payments/financial_center/overview/`),
  read('payments.wallet_payouts', `${B}/payments/booksy_wallet/payouts/`),
  read('registers.list', `${B}/pos/registers`),
  read('registers.read', `${B}/pos/registers/:registerId`),
  read('registers.operations', `${B}/pos/registers/:registerId/operations`),
  read('registers.download', `${B}/pos/registers/:registerId/direct_download/`, {
    binary: true,
    cacheSeconds: 0,
  }),
  read('registers.cash_document', `${B}/invoicing/cash_register_document/:documentId/preview`, {
    binary: true,
    cacheSeconds: 0,
  }),
  read('invoices.list', `${B}/invoicing/invoice/`),
  read('invoices.read', `${B}/invoicing/invoice/:invoiceId`),
  read('invoices.pdf', `${B}/invoicing/invoice/:invoiceId/preview`, {
    binary: true,
    cacheSeconds: 0,
  }),

  // Products and warehouse
  read('warehouse.commodities', `${WH}/commodities`),
  read('warehouse.history', `${B}/commodity/:commodityId/warehouse/:warehouseId/history`),
  read('warehouse.list', `${WH}/warehouses`, { cacheSeconds: CATALOG }),
  read('warehouse.detail', `${WH}/warehouses/:warehouseId`, { cacheSeconds: CATALOG }),
  read('warehouse.documents', `${WH}/documents`),
  read('warehouse.document', `${WH}/documents/:documentId`),
  read('warehouse.brands', `${WH}/brands`, { cacheSeconds: CATALOG }),
  read('warehouse.category_tree', `${WH}/category_tree`, { cacheSeconds: CATALOG }),
  read('warehouse.suppliers', `${WH}/supplier/`, { cacheSeconds: CATALOG }),

  // Other
  read('notifications.list', `${B}/notification_list/:status/`),
  read('vouchers.list', `${B}/vouchers/`),
  read('vouchers.orders', `${B}/voucher_orders/`),
  read('vouchers.templates', `${B}/voucher_templates/`, { cacheSeconds: CATALOG }),
  read('consents.forms', `${B}/consent_forms/`, { cacheSeconds: CATALOG }),
  read('consents.list', `${B}/consents/`),
  read('consents.pdf', `${B}/consents/:consentUuid/pdf`, { binary: true, cacheSeconds: 0 }),
  read('waitlist.list', `${B}/waitlist/`),
  read('loyalty.program', '/loyalty-card-service/v1/loyalty-card-programs/:country/:businessId/current', {
    cacheSeconds: CATALOG,
  }),
  read('loyalty.cards', '/loyalty-card-service/v1/loyalty-cards/:country/:businessId'),
];

const BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));
const SAFE_VALUE = /^[A-Za-z0-9_-]{1,128}$/;
/** Filled in by the panel itself, from the salon open in the tab. */
const PANEL_FILLED = new Set(['businessId', 'country']);

export function getRule(ruleId: string): Rule | undefined {
  return BY_ID.get(ruleId);
}

export function pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] as string);
}

export class RuleError extends Error {}

/**
 * Validates a request against its rule. Returns the rule, or throws. Used on both sides of the
 * bridge, so a change on one side cannot widen what the other side accepts.
 */
export function resolveRule(ruleId: string, urlParams: Record<string, string> = {}): Rule {
  const rule = BY_ID.get(ruleId);
  if (!rule) throw new RuleError(`Unknown rule: ${ruleId}`);

  const expected = pathParams(rule.path).filter((name) => !PANEL_FILLED.has(name));
  for (const name of expected) {
    const value = urlParams[name];
    if (value === undefined || !SAFE_VALUE.test(value)) {
      throw new RuleError(`Invalid value for path parameter "${name}" of ${ruleId}`);
    }
  }
  for (const name of Object.keys(urlParams)) {
    if (!expected.includes(name)) {
      throw new RuleError(`Unexpected path parameter "${name}" for ${ruleId}`);
    }
  }
  return rule;
}
