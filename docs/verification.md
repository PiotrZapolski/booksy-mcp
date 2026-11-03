# Live verification

Most of this project comes from reading the panel's public JavaScript. A first passive look at a
real Polish panel was done on 2026-11-02: GET requests the panel made by itself, nothing sent by this
project. What it confirmed is marked `live` in [endpoints.md](endpoints.md). The tools themselves
have not been run against a real panel yet. This list is for that check.

## Rules for the check

- Use your own logged-in panel, in your own Chrome, on your own computer.
- GET requests only. Do not click anything that saves, sends or changes data.
- Prefer watching what the panel does by itself: open a screen and read the requests it made.
- Record addresses, status codes and field names. Never record header values, tokens, cookies, client
  names, phone numbers, e-mails or real IDs.
- Stop at the first 403, 429, captcha or "request blocked" answer, and do not retry.

## Step 1: passive check, without this project

Done for the main panel on 2026-11-02, see `live` in [endpoints.md](endpoints.md). Still open: every
row that names `{S}`, because those requests come from a frame the check could not see (see
[the report frame](#the-report-frame)), and the rows without a `live` entry.

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

## The report frame

The statistics screens (Panel, Wizyty, Klienci, Przychód, Wpływy płatności, Magazyn, Pracownicy,
Marketing and reports such as "Lista wizyt") run in a cross-origin frame on
`stats-and-reports.booksy.com`. A second frame on `web-gateway.booksy.com` keeps the session.
Requests from these frames do not show up in the main tab.

What the frame's public JavaScript shows:

- It has no session of its own. When it starts, it asks the panel over `postMessage` for `identity`
  (access token and profile), `business`, `config` and `locale`. No cookie carries the login.
- Its API client is private to its module. Nothing outside the frame can call it, and the only other
  way to make those requests is to read the token out of the frame or to copy its headers.
- It calls `https://{country}.booksy.com/api/{country}/2/business_api/me/stats/...`.
- For a download it sends `downloadFromApi` to the panel, and the panel makes the request with its
  own client through `/core/v2`, with the same `{S}/report/download` path.

So this project does not run requests inside the frame: that would need the token, which this project
never touches. All `{S}` rules go through the panel's own client in the main tab, exactly as the
download button already does. The tools then work from any panel screen. Whether the plain `{S}`
reads are accepted on `/core/v2` the way the download is, nothing but a live check can tell.

The extension can read the addresses the frame used: `stats_frame_requests` looks into the frame,
from the extension's isolated world, and returns address shapes and parameter names only. It sends
nothing to Booksy and does not touch `web-gateway.booksy.com`.

To check, in this order, and stop at the first 403, 429 or block:

1. Open Statistyki in the panel, wait for the screen, then run `stats_frame_requests`. Write down the
   host, the prefix (`/api/pl/2/` expected) and the parameter names for each screen below.
2. Compare them with the `{S}` rows above: `dashboard/main`, `dashboard` with `dashboard=...`,
   `report`, `section`, `report/metadata`, `billing/cycles`. Move what matches to `live`.
3. Open one report, for example Lista wizyt, and press Pobierz by hand once. Note in DevTools of the
   main tab that `{S}/report/download` goes through `/core/v2`, with which parameters, and what the
   file type and `Content-Disposition` are.
4. Run `stats_overview` once, from a different panel screen than Statistyki. This is the one request
   of this list that this project sends. A 200 with the figures of the screen means the `/core/v2`
   route works for reads.
5. If step 4 fails with 404: change the `{S}` read rules so the panel's client uses the frame's
   prefix, and test once more. If it fails with 403 or a block: stop. Reads then need another design,
   and there is no version of it that hands the token to this project.
6. Confirm that `stats_frame_requests` returns nothing for `web-gateway.booksy.com`.

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
11. `{B}/monthly_bookings`: does `version` stay `3`, and does the answer work without `resource_id`?
    The tool always sends the ids, as the panel does.
12. Which status does a statistics section answer when the plan does not include it? A 403 stops all
    traffic for an hour in safe mode, and `stats_report_catalog` reads every section. If this is
    common, read sections one by one with `dashboard`, and consider a softer rule for that case.
13. `{B}/customers/:customerId/bookings`: which values do `state` and `inlcude_extra_bookings` take?

## Step 3: this project, read tools only

Do not enable any write tool for this step. Leave "Allow writes" off in the extension.

1. Load the extension and pair it with `session_status`.
2. Confirm that the extension works with `booksy.com/pro`, `stats-and-reports.booksy.com` and the
   local port. Check in particular that Chrome's local network protection does not block the
   connection. API calls to `pl.booksy.com` are made by the panel page, so they need no permission
   of the extension.
3. Confirm that the panel's store is reachable: `session_status` shows the salon name.
4. Run in this order, with a pause between them: `business_profile`, `service_menu`,
   `team_resources`, `calendar_agenda` for today, `staff_schedule` for this week, `stats_overview`,
   `stats_report_catalog` for one section, `report_export` for one report.
5. Compare one day of `calendar_agenda` and one report with what the panel shows.
6. Check safe mode: `session_status` shows `mode: safe` and growing use of the budget.

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
