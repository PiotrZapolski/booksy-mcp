# Live verification

Everything in this project comes from reading the panel's public JavaScript. Nothing has been run
against a real panel yet. This list is for the first live check.

## Rules for the check

- Use your own logged-in panel, in your own Chrome, on your own computer.
- GET requests only. Do not click anything that saves, sends or changes data.
- Prefer watching what the panel does by itself: open a screen and read the requests it made.
- Record addresses, status codes and field names. Never record header values, tokens, cookies, client
  names, phone numbers, e-mails or real IDs.
- Stop at the first 403, 429, captcha or "request blocked" answer, and do not retry.

## Step 1: passive check, without this project

Open each panel screen once and note the GET requests. The tool name shows who depends on each one.

| Panel screen | Confirm these GET requests | Tools |
| --- | --- | --- |
| Calendar, day view | `{B}/calendar` with `start_date`, `end_date`, `include_unconfirmed`, `version`, `resources_per_page` | `calendar_agenda`, `calendar_open_slots`, `appointment_requests`, `appointment_changes_feed` |
| Calendar, month view | `{B}/monthly_bookings` | `calendar_month` |
| Calendar, left open for a minute | `{B}/calendar/changed_dates/:timestamp/` | `calendar_changed_dates` |
| An appointment | `{B}/appointments/:appointmentUid/`, `{B}/payments/appointments/:appointmentId/details/` | `appointment_details`, `appointment_payment_details` |
| Staff | `{B}/resources`, `/business_api/me/resources/:resourceId` | `team_resources`, `resource_details` |
| Shifts | `{B}/shifts` with `week_start_date` | `staff_schedule`, `time_off_entries`, `opening_hours` |
| Services | `{B}/service_categories`, `{B}/services/addons` | `service_menu`, `service_addons` |
| Clients | `{B}/customers`, `{B}/customers/:customerId`, `{B}/customers/:customerId/bookings`, `{B}/customers/tags` | `customer_cards`, `customer_card`, `customer_visit_history`, `customer_tags` |
| Reviews | `{B}/reviews/` | `reviews_feed` |
| Statistics, main screen | `{S}/dashboard/main` | `stats_overview` |
| Statistics, each section | `{S}/dashboard?dashboard=...` | `stats_dashboard`, `stats_report_catalog` |
| Any report | `{S}/report/metadata`, `{S}/report`, `{S}/section` | `stats_report_metadata`, `stats_report`, `stats_report_section` |
| Any report, the download button | `{S}/report/download`, with `responseType` blob | `report_export`, `report_export_batch` |
| Payments | `{B}/pos/payment_rows`, `{B}/pos/payment_rows_summary` | `payment_rows`, `payment_summary` |
| Checkout list | `{B}/pos/transactions`, `{B}/pos/booking_charges` | `checkout_transactions`, `booking_charges` |
| A transaction | `{B}/pos/transactions/:transactionId`, `{B}/payments/baskets/:basketId` | `checkout_transaction`, `payment_basket` |
| Cash registers | `{B}/pos/registers`, `{B}/pos/registers/:registerId/operations` | `cash_registers`, `cash_register_operations` |
| Wallet | `{B}/payments/financial_center/overview/`, `{B}/payments/booksy_wallet/payouts/` | `wallet_overview`, `wallet_payouts` |
| Products | `{B}/warehouse/commodities`, `{B}/warehouse/warehouses`, `{B}/warehouse/documents` | `product_catalog`, `warehouses`, `warehouse_documents` |
| A product's history | `{B}/commodity/:commodityId/warehouse/:warehouseId/history` | `product_stock_history` |
| Campaigns | `{B}/message_blast/`, `{B}/message_blast/scheduled/`, `{B}/sms/management/` | `campaign_groups`, `campaign_schedule`, `campaign_sms_balance` |
| Client chat, if the panel has it | `{B}/stream_chat/config/` | `chat_conversations`, `chat_messages` |
| Notifications bell | `{B}/notification_list/:status/` | `panel_notifications` |

`{B}` is `/business_api/me/businesses/:businessId`, `{S}` is
`/business_api/me/stats/businesses/:businessId`.

Entries in [endpoints.md](endpoints.md) confirmed here move from `bundle` or `do weryfikacji` to a
new value, `live`.

## Step 2: questions the code cannot answer

1. Which HTTP methods do `{B}/customers/tags`, the two wallet paths, `warehouse/documents/:documentId`
   and the product history use? Each is marked `do weryfikacji`.
2. Does the report list inside a dashboard answer really have `reports[].key` and `reports[].title`
   for every section?
3. Which `report_key` values match these panel downloads: appointments list, clients list, staff
   working time, product sales, sales report, sales list?
4. What does the download answer look like: xlsx or csv, and is `Content-Disposition` readable from
   the panel's client?
5. Is there a page parameter for long JSON reports, and is it called `page`?
6. Which fields do calendar bookings use for status and staff? The code expects `status`,
   `appointment_uid`, `booked_from`, `booked_till`, `staffer_id`, `resources`.
7. Does `shifts` return `schedule.resources[].schedule[]` with `date`, `hours` and `time_offs`? Do
   entries in `time_offs` carry an id usable for `time_off_remove`?
8. What are the `resources` type values? The code expects `S` for staff and `R` for stations.
9. What are the panel's `timezone` and `first_day_of_week` values for the salon, and does
   `week_start_date` need to be a Monday?
10. What does `{B}/notifications/` return compared with the bell list?

## Step 3: this project, read tools only

Do not enable any write tool for this step. Leave "Allow writes" off in the extension.

1. Load the extension and pair it with `session_status`.
2. Confirm that the extension works with only `booksy.com/pro` and the local port. Check in
   particular that Chrome's local network protection does not block the connection.
3. Confirm that the panel's store is reachable: `session_status` shows the salon name.
4. Run in this order, with a pause between them: `business_profile`, `service_menu`,
   `team_resources`, `calendar_agenda` for today, `staff_schedule` for this week, `stats_overview`,
   `stats_report_catalog` for one section, `report_export` for one report.
5. Compare one day of `calendar_agenda` and one report with what the panel shows.

## Step 4: before enabling any write

Writes were never run. Each needs its own check on a test appointment or a test client:

- `appointment_book`: confirm the `customer` object, the `service_variant` shape and whether
  `dry_run` belongs in the body. The dry run endpoint itself is safe to try first.
- `appointment_move`: confirm that sending back the full appointment with changed times is accepted.
- `time_off_add`: confirm the body and the `approved` flag.
- `customer_update`, `customer_note_set`: confirm that a partial update leaves other fields alone.
- `review_reply`: confirm the date format of `reply_updated`.
- `campaign_send`: confirm what `recipients` must contain, with `campaign_estimate` only.
- `chat_reply`: confirm the read tools first, on a test conversation.
