/**
 * Tool groups. Only "core" is listed to an MCP client by default, so an assistant starts with the
 * tools a salon uses every day. The other groups are turned on in the configuration (toolGroups or
 * BOOKSY_MCP_TOOL_GROUPS). Every tool belongs to exactly one group, and a test keeps it that way.
 */
export const GROUP_NAMES = [
  'core',
  'payments',
  'inventory',
  'vouchers',
  'marketing',
  'business',
  'diagnostics',
] as const;

export type ToolGroup = (typeof GROUP_NAMES)[number];

export const CORE_GROUP: ToolGroup = 'core';
/** Stands for every group, in the configuration and in "setup --groups". */
export const ALL_GROUPS = 'all';

export const GROUP_SUMMARY: Record<ToolGroup, string> = {
  core:
    'Session, calendar and appointments, staff and schedules, services, clients, reviews, ' +
    'notifications, waitlist, statistics and report exports',
  payments:
    'Payments, checkout transactions, wallet and payouts, cash registers, invoices and their ' +
    'documents',
  inventory: 'Products, stock, warehouses, stock documents, brands, categories and suppliers',
  vouchers: 'Vouchers and gift cards, consent forms and loyalty cards',
  marketing: 'Message campaigns, SMS balance and client chat',
  business: 'Business profile, visibility, booking rules, integrations and other settings',
  diagnostics: 'Checks for verifying this project against a live panel',
};

const GROUP_TOOLS: Record<ToolGroup, string[]> = {
  core: [
    'session_status',
    'opening_hours',
    // Calendar and appointments
    'calendar_agenda',
    'appointment_requests',
    'calendar_open_slots',
    'appointment_changes_feed',
    'calendar_month',
    'calendar_changed_dates',
    'appointment_details',
    'waitlist',
    'appointment_book',
    'appointment_move',
    'appointment_cancel',
    'appointment_confirm',
    'appointment_decline',
    'appointment_mark_no_show',
    // Staff, stations and time
    'team_resources',
    'staff_schedule',
    'time_off_entries',
    'resource_details',
    'resource_upcoming_bookings',
    'time_block_details',
    'time_off_add',
    'time_off_remove',
    'time_block_add',
    'time_block_remove',
    // Services
    'service_menu',
    'service_details',
    'service_addons',
    // Clients
    'customer_cards',
    'customer_card',
    'customer_visit_history',
    'customer_product_history',
    'customer_groups',
    'customer_tags',
    'customer_file_download',
    'customer_add',
    'customer_update',
    'customer_note_set',
    'customer_delete',
    // Reviews and notifications
    'reviews_feed',
    'review_reply',
    'panel_notifications',
    // Statistics and report exports
    'stats_overview',
    'stats_dashboard',
    'stats_report_catalog',
    'stats_report_metadata',
    'stats_report',
    'stats_report_section',
    'stats_billing_cycles',
    'report_export',
    'report_export_batch',
  ],
  payments: [
    'appointment_payment_details',
    'payment_rows',
    'payment_summary',
    'checkout_transactions',
    'checkout_transaction',
    'checkout_last_receipt',
    'booking_charges',
    'payment_basket',
    'refund_fee_preview',
    'wallet_overview',
    'wallet_payouts',
    'cash_registers',
    'cash_register',
    'cash_register_operations',
    'invoices',
    'invoice',
    // Its ids come from cash_registers and invoices. Consent PDFs also need the vouchers group.
    'document_download',
  ],
  inventory: [
    'product_catalog',
    'product_stock_history',
    'warehouses',
    'warehouse_details',
    'warehouse_documents',
    'warehouse_document',
    'product_brands',
    'product_categories',
    'product_suppliers',
  ],
  vouchers: [
    'vouchers',
    'voucher_orders',
    'voucher_templates',
    'consent_forms',
    'consents_signed',
    'loyalty_program',
    'loyalty_cards',
  ],
  marketing: [
    'campaign_estimate',
    'campaign_groups',
    'campaign_details',
    'campaign_schedule',
    'campaign_sms_balance',
    'campaign_send',
    'chat_conversations',
    'chat_messages',
    'chat_quick_actions',
    'chat_reply',
  ],
  business: [
    'business_accounts',
    'business_profile',
    'business_visibility',
    'business_amenities',
    'business_features',
    'business_booking_rules',
    'business_integrations',
    'business_notification_settings',
    'business_pos_settings',
    'business_no_show_protection',
  ],
  diagnostics: ['stats_frame_requests'],
};

const GROUP_OF = new Map<string, ToolGroup>(
  GROUP_NAMES.flatMap((group) => GROUP_TOOLS[group].map((name) => [name, group] as const)),
);

/** Tool names of one group, as assigned above. */
export function toolNamesOf(group: ToolGroup): readonly string[] {
  return GROUP_TOOLS[group];
}

/** The group of a tool, or undefined for a name that is not a tool. */
export function groupOf(toolName: string): ToolGroup | undefined {
  return GROUP_OF.get(toolName);
}

export const isGroupName = (value: string): value is ToolGroup =>
  (GROUP_NAMES as readonly string[]).includes(value);

export interface GroupSelection {
  enabled: Set<ToolGroup>;
  /** Names from the configuration that are not a group. They are ignored, with a warning. */
  unknown: string[];
}

/** Core is always on. "all" turns on every group. Unknown names never turn anything on. */
export function resolveGroups(configured: readonly string[] | undefined): GroupSelection {
  const names = [...new Set((configured ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean))];
  const unknown = names.filter((name) => name !== ALL_GROUPS && !isGroupName(name));
  const enabled = names.includes(ALL_GROUPS)
    ? new Set<ToolGroup>(GROUP_NAMES)
    : new Set<ToolGroup>([CORE_GROUP, ...names.filter(isGroupName)]);
  return { enabled, unknown };
}

/** One sentence for the user on how to turn groups on. */
export function enableHint(groups: readonly string[]): string {
  const list = groups.length > 0 ? groups : ['payments'];
  return (
    `add ${list.map((group) => `"${group}"`).join(', ')} to "toolGroups" in ` +
    `~/.config/booksy-mcp/config.json (for example "toolGroups": ${JSON.stringify(list)}), or set ` +
    `BOOKSY_MCP_TOOL_GROUPS=${list.join(',')}, then restart the MCP client. "toolGroups": "all" ` +
    'turns on every group'
  );
}

export function unknownGroupsWarning(unknown: readonly string[]): string {
  return (
    `Unknown tool group${unknown.length === 1 ? '' : 's'} in the configuration: ` +
    `${unknown.join(', ')}. Ignored. Known groups: ${GROUP_NAMES.join(', ')}, or "all".`
  );
}
