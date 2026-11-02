# Booksy Biz panel endpoints

Catalogue of the requests the Booksy Biz web panel can make, read from the panel's public JavaScript
files, which the panel serves without logging in. It is reference material for this project. It
holds no tokens, no personal data and no IDs of real businesses.

Booksy can change any of this at any time. This is not an official API.

## How to read it

- **Source:** panel build `331eddea` and its report, inventory and wallet frontends, read on
  2026-11-02. Only unauthenticated files were downloaded. No request was sent to any endpoint here.
- **Confidence:**
  - `bundle`: the path and the HTTP method are both visible in a panel call.
  - `do weryfikacji`: the path is in the bundle, but the method or the call is not clear from the
    code. It needs checking against real panel traffic.
  - No entry is marked as confirmed live yet. See [verification.md](verification.md).
- **Access:** `read`, `estimate` (a POST or PUT that calculates without saving), `write`, or `?`.
- **Tool:** the tool in this project that uses the endpoint. An empty cell means the endpoint is not
  in the allowlist, so this project cannot call it.
- **Parameters:** the ones seen near the call. The list may be incomplete. Path parameters are in
  the path.

Abbreviations: `{B}` is `/business_api/me/businesses/:businessId`, `{S}` is
`/business_api/me/stats/businesses/:businessId`.

## How the panel talks to the API

- The panel is a Vue application under `booksy.com/pro`.
- Core calls go to `https://{country}.booksy.com/core/v2`. Other services use their own prefix on
  the panel origin, for example `/loyalty-card-service/`.
- The panel's client adds `X-Api-Key`, `X-Access-Token`, `X-Fingerprint`, `X-App-Version`,
  `Accept-Language` and a request id. This project does not set any of them: it calls that client.
- The session token is kept in a frame on `web-gateway.booksy.com` and restored into the panel's
  store memory.
- Reports run in a separate frontend on `stats-and-reports.booksy.com`. File downloads are passed
  back to the panel and made by the panel's client.
- Report keys are not in the code. The report screens get them from the API (`reports[].key`).
- Panel sections of the reports screen: `appointments`, `clients`, `revenue`, `cash_flow`,
  `inventory`, `staff`, `promotion`, `tips`.
- `time_span` values: `day`, `week`, `month`, `year`, `between`, `last_7_days`, `last_14_days`,
  `last_30_days`, `last_3_months`, `last_6_months`.
- Appointment status codes: `A` accepted, `C` canceled, `D` declined, `F` finished, `M` modified,
  `N` no-show, `O` prepayment awaiting, `P` proposed, `R` rejected, `V` unverified, `W` waiting
  for confirmation.
- Appointment actions: `cancel`, `confirm`, `decline`, `no_show`, `cancel_no_show`.
- Client chat runs on a third-party chat service. The panel gets a chat token from
  `{B}/stream_chat/token/` and talks to `chat.stream-io-api.com`, on channel type `messaging`.
- Some paths need a captcha. The list comes from the routing configuration
  (`hcaptcha`, `hcaptcha_business_frontdesk_enabled`). This project refuses those paths.

## Summary

- 668 entries: 506 `bundle`, 162 `do weryfikacji`.
- 95 of them are in this project's allowlist.

## Session and account

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/business_api/account` |  | create account | write | bundle |  |
| GET | `/business_api/account/exists` | email | account exists | read | bundle |  |
| POST | `/business_api/account/login` |  | account login | write | bundle |  |
| POST | `/business_api/account/login/apple` |  | account login apple | write | bundle |  |
| POST | `/business_api/account/login/auth_token` |  | auth token | write | bundle |  |
| POST | `/business_api/account/login/facebook` |  | account login fb | write | bundle |  |
| POST | `/business_api/account/login/google/one_tap` |  | account login google | write | bundle |  |
| POST | `/business_api/account/logout` |  | account logout | write | bundle |  |
| POST | `/business_api/account/password_reset` |  | reset password | write | bundle |  |
| POST | `/business_api/account/sms_code` |  | account sms code | write | bundle |  |
| PUT | `/business_api/me` |  | account me | write | bundle |  |
| GET | `/business_api/me` |  | account me | read | bundle |  |
| ? | `/business_api/me/account_deletion` |  | account deletion | ? | do weryfikacji |  |
| POST | `/business_api/me/auth_token` |  | get auth token | write | bundle |  |
| PUT | `/business_api/me/color_palette` |  | business service color palette | write | bundle |  |
| POST | `/business_api/me/connect` |  | connect with facebook | write | bundle |  |
| POST | `/business_api/me/connect/google` |  | connect with google | write | bundle |  |
| DELETE | `/business_api/me/facebook/v3` | business_id, access_token | facebook api base url | write | bundle |  |
| POST | `/business_api/me/facebook/v3` | business_id, access_token | facebook api base url | write | bundle |  |
| POST | `/business_api/me/facebook/v3/dialog_oauth` | client_type, business_id | facebook oauth | write | bundle |  |
| GET | `/business_api/me/facebook/v3/dialog_oauth` | client_type, business_id | facebook oauth | read | bundle |  |
| GET | `/business_api/me/iterable` |  | iterable jwt | read | do weryfikacji |  |
| GET | `/business_api/referral_code/:code` |  | referral code | read | bundle |  |
| GET | `/celery/task/:taskId` |  | celery task status | read | bundle |  |
| ? | `/config` |  | route config | ? | do weryfikacji |  |
| GET | `/config` |  | route config | read | bundle |  |
| GET | `/experiment/:experimentName/experiment_variant/:relationId` |  | experiments | read | bundle |  |
| GET | `/other/apple_token` |  | mapkit token | read | bundle |  |
| POST | `/otp/resend` |  | otp resend | write | bundle |  |
| GET | `/route/environments` |  | route environments | read | bundle |  |
| ? | `/routing/config` |  | routing config | ? | do weryfikacji |  |
| GET | `/routing/config/billing` |  | billing global settings | read | bundle |  |
| GET | `/routing/server_time` |  | server time | read | do weryfikacji |  |
| POST | `/utils/password_check` |  | password check | write | bundle |  |
| POST | `/utils/phone_check` |  | phone check | write | bundle |  |
| GET | `/utils/reverse_geocode` | latitude, longitude, decoder | reverse geocode | read | bundle |  |

## Statistics and reports

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `{B}/billing/cycles` |  | billing cycles | read | bundle | `stats_billing_cycles` |
| ? | `{B}/business_statistics` |  | warehouse reports | ? | do weryfikacji |  |
| POST | `{B}/stats/report/send_by_email` | date_from, email, report_key, time_span | send a report by e-mail | write | bundle |  |
| GET | `{B}/visibility_promotion/dashboard/stats` |  | dashboard stats | read | bundle |  |
| ? | `{S}/dashboard` | date_from, date_till, time_span, dashboard | new stats dashboard | ? | do weryfikacji |  |
| GET | `{S}/dashboard` | date_from, date_till, time_span, dashboard | new stats dashboard | read | bundle | `stats_dashboard`, `stats_report_catalog` |
| ? | `{S}/dashboard/main` | date_from, date_till, time_span | new stats dashboard main | ? | do weryfikacji |  |
| GET | `{S}/dashboard/main` | date_from, date_till, time_span | new stats dashboard main | read | bundle | `stats_overview` |
| ? | `{S}/report` | date_from, date_till, time_span, report_key, filters | new stats report | ? | do weryfikacji |  |
| GET | `{S}/report` | date_from, date_till, time_span, report_key, filters | new stats report | read | bundle | `stats_report` |
| ? | `{S}/report/download` | date_from, date_till, time_span, report_key, filters | new stats download | ? | do weryfikacji |  |
| GET | `{S}/report/download` | date_from, date_till, time_span, report_key, filters | new stats download | read | bundle | `stats_report_catalog` |
| GET | `{S}/report/metadata` | report | report metadata and filters | read | bundle | `stats_report_metadata` |
| ? | `{S}/section` | date_from, date_till, time_span, section parameters | new stats section | ? | do weryfikacji |  |
| GET | `{S}/section` | date_from, date_till, time_span, section parameters | new stats section | read | bundle | `stats_report_section` |

## Calendar and appointments

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| ? | `{B}/appointments` |  | appointments | ? | do weryfikacji |  |
| ? | `{B}/appointments/:appointmentType/:appointmentId` |  | appointment | ? | do weryfikacji |  |
| GET | `{B}/appointments/:appointmentUid` |  | appointment uid | read | bundle | `appointment_details`, `customer_file_download` |
| ? | `{B}/appointments/:appointmentUid/action` |  | appointment action | ? | do weryfikacji |  |
| GET | `{B}/appointments/:appointmentUid/appointment_recommendation` |  | appointments appointment recommendation | read | bundle |  |
| GET | `{B}/appointments/:appointmentUid/book_again` |  | appointment redo | read | bundle |  |
| ? | `{B}/appointments/:appointmentUid/dry_run` |  | appointment uid dryrun | ? | do weryfikacji |  |
| POST | `{B}/appointments/:appointmentUid/notify_ready` |  | appointment ready | write | bundle |  |
| ? | `{B}/appointments/dry_run` |  | appointments dryrun | ? | do weryfikacji |  |
| GET | `{B}/billing/boost/overdue/appointments` |  | billing overdue boost | read | bundle |  |
| GET | `{B}/calendar` |  | business calendar | read | bundle | `calendar_agenda`, `calendar_open_slots`, `appointment_requests`, `appointment_changes_feed` |
| ? | `{B}/calendar/banners` |  | calendar banners | ? | do weryfikacji |  |
| GET | `{B}/calendar/banners/redirection` |  | calendar banners redirection | read | do weryfikacji |  |
| GET | `{B}/calendar/changed_dates/:timestamp` |  | business calendar change dates | read | bundle | `calendar_changed_dates` |
| GET | `{B}/calendar/customers` |  | calendar customers | read | bundle |  |
| PUT | `{B}/calendar/drag_subbooking/:bookingId` |  | appointment drag | write | bundle |  |
| GET | `{B}/calendar/next_staffer` | for_date, e | next staffer | read | do weryfikacji |  |
| GET | `{B}/calendar/splash` |  | calendar splash | read | do weryfikacji |  |
| POST | `{B}/calendar/splash/prepayment` |  | splash prepayment | write | bundle |  |
| ? | `{B}/monthly_bookings` |  | business calendar monthly | ? | do weryfikacji |  |
| GET | `{B}/payments/appointments/:appointmentId/details` |  | appointments details | read | bundle | `appointment_payment_details` |
| GET | `{B}/repeating_bookings/:repeatingId` |  | repeating | read | bundle |  |
| ? | `{B}/reservations` |  | reservation new | ? | do weryfikacji |  |
| ? | `{B}/turntracker/finished_turns` |  | turn tracker finish turn | ? | do weryfikacji |  |
| DELETE | `{B}/turntracker/finished_turns/:finishTurnId` |  | turn tracker finished turn | write | bundle |  |
| GET | `{B}/turntracker/finished_turns/:finishTurnId` |  | turn tracker finished turn | read | bundle |  |
| GET | `{B}/turntracker/grid` |  | turn tracker grid | read | bundle |  |
| POST | `{B}/turntracker/list/append` |  | list append | write | bundle |  |
| DELETE | `{B}/turntracker/list/next_client` |  | list next client | write | bundle |  |
| GET | `{B}/turntracker/list/next_client` |  | list next client | read | bundle |  |
| GET | `{B}/turntracker/pentile` |  | turn tracker pentile | read | do weryfikacji |  |
| POST | `{B}/turntracker/pin/validate` |  | pin validate | write | bundle |  |
| PUT | `{B}/turntracker/settings` |  | turn tracker settings | write | bundle |  |
| GET | `{B}/turntracker/settings` |  | turn tracker settings | read | bundle |  |
| POST | `{B}/turntracker/settings/pin` |  | settings pin | write | bundle |  |
| GET | `{B}/turntracker/staff` |  | turn tracker staff | read | bundle |  |
| PUT | `{B}/turntracker/staff_order` |  | turn tracker staff order | write | bundle |  |
| ? | `{B}/turntracker/staff/:stafferId` |  | turn tracker staffer | ? | do weryfikacji |  |
| ? | `{B}/turntracker/staff/availability` |  | turn tracker staff availability | ? | do weryfikacji |  |
| GET | `{B}/waitlist` |  | businesses waitlist | read | bundle | `waitlist` |
| DELETE | `{B}/waitlist/:waitlistId` |  | businesses waitlist | write | bundle |  |
| GET | `{B}/waitlist/:waitlistId` |  | businesses waitlist | read | bundle |  |
| GET | `/business_api/me/reservations/:reservationId` |  | reservation | read | bundle | `time_block_details` |
| DELETE | `/business_api/me/reservations/:reservationId` |  | reservation | write | bundle | `time_block_remove` |
| GET | `/provider-calendar-importer/v1/calendar_import/:country/business/:businessId/config` |  | business config | read | bundle |  |
| DELETE | `/provider-calendar-importer/v1/calendar_import/:country/business/:businessId/import_details` |  | business import details | write | bundle |  |
| GET | `/provider-calendar-importer/v1/calendar_import/:country/business/:businessId/import_details` |  | business import details | read | bundle |  |
| POST | `/provider-calendar-importer/v1/calendar_import/:country/business/:businessId/upload_signed_url` |  | business upload signed url | write | bundle |  |
| POST | `/waitlist` |  | waitlist | write | bundle |  |

## Staff, stations and shifts

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| ? | `{B}/pos/commissions/mass/resources/:resourceId/egifts` |  | pos commission change resource egifts | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/resources/:resourceId/memberships` |  | pos commission change resource memberships | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/resources/:resourceId/packages` |  | pos commission change resource packages | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/resources/:resourceId/products` |  | pos commission change resource products | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/resources/:resourceId/service_variants` |  | pos commission change resource service variants | ? | do weryfikacji |  |
| POST | `{B}/resources` |  | resources | write | bundle |  |
| GET | `{B}/resources` |  | resources | read | bundle | `team_resources` |
| PUT | `{B}/resources` |  | resources | write | bundle |  |
| ? | `{B}/resources` |  | resources | ? | do weryfikacji |  |
| GET | `{B}/resources/:resourceId/permission_overrides` |  | resources permission overrides | read | bundle |  |
| PUT | `{B}/resources/:resourceId/permission_overrides` |  | resources permission overrides | write | bundle |  |
| GET | `{B}/resources/:resourceId/upcoming_bookings` |  | resources upcoming bookings | read | bundle | `resource_upcoming_bookings` |
| GET | `{B}/resources/permission_overrides/defaults` |  | permission overrides defaults | read | bundle |  |
| GET | `{B}/shifts` | week_start_date | shifts | read | bundle | `staff_schedule`, `time_off_entries`, `opening_hours`, `calendar_open_slots` |
| POST | `{B}/shifts` | week_start_date | shifts | write | bundle |  |
| POST | `{B}/shifts/copy` |  | shifts copy | write | bundle |  |
| POST | `{B}/shifts/opening_hours` |  | shifts opening hours | write | bundle |  |
| POST | `{B}/shifts/resources/:resourceId` |  | shifts resource | write | bundle |  |
| GET | `{B}/shifts/resources/:resourceId/time_offs/:timeOffId` |  | shifts time off edit | read | do weryfikacji |  |
| POST | `{B}/shifts/resources/:resourceId/working_hours` |  | shifts working hours | write | bundle |  |
| POST | `{B}/shifts/resources/time_offs` |  | shifts time offs | write | bundle | `time_off_add` |
| GET | `/business_api/me/resources/:resourceId` |  | resource | read | bundle | `resource_details` |
| PUT | `/business_api/me/resources/:resourceId` |  | resource | write | bundle |  |
| DELETE | `/business_api/me/resources/:resourceId` |  | resource | write | bundle |  |
| ? | `/business_api/me/resources/:resourceId/invite` |  | resource invite | ? | do weryfikacji |  |
| POST | `/business_api/me/resources/photo` |  | resource photo | write | bundle |  |

## Services

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/business_api/categories` |  | business api categories | read | bundle |  |
| GET | `{B}/categories` |  | business categories | read | bundle |  |
| GET | `{B}/features_status/service_promotions` |  | tile statuses promotions | read | bundle |  |
| POST | `{B}/pos/apply_tax_rate/services` |  | pos apply tax rate for services | write | bundle |  |
| ? | `{B}/pos/commissions/mass/service_variants` |  | pos commission change service variants | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/product_categories/service_variants` |  | pos commission services categories | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/service_variants` |  | pos commission service variants | ? | do weryfikacji |  |
| GET | `{B}/service_categories` | with_combos | service categories | read | bundle | `service_menu` |
| POST | `{B}/service_categories` | with_combos | service categories | write | bundle |  |
| PUT | `{B}/service_categories` | with_combos | service categories | write | bundle |  |
| PUT | `{B}/service_categories/:serviceCategoryId` |  | service category | write | bundle |  |
| DELETE | `{B}/service_categories/:serviceCategoryId` |  | service category | write | bundle |  |
| ? | `{B}/service_categories/:serviceCategoryId` |  | service category | ? | do weryfikacji |  |
| GET | `{B}/service_hints` | text, with_defaults | services hints | read | bundle |  |
| POST | `{B}/service_suggestion` | with_defaults | services suggestion | write | bundle |  |
| POST | `{B}/services` | use_variants_staffers, use_service_type | services | write | bundle |  |
| PUT | `{B}/services` | use_variants_staffers, use_service_type | services | write | bundle |  |
| DELETE | `{B}/services/:serviceId` | use_variants_staffers, use_service_type | service | write | bundle |  |
| GET | `{B}/services/:serviceId` | use_variants_staffers, use_service_type | service | read | bundle | `service_details` |
| PUT | `{B}/services/:serviceId` | use_variants_staffers, use_service_type | service | write | bundle |  |
| ? | `{B}/services/:serviceId/addons` |  | service addons | ? | do weryfikacji |  |
| POST | `{B}/services/:serviceId/photo` |  | service photo upload | write | bundle |  |
| PUT | `{B}/services/:serviceId/photo` |  | service photo upload | write | bundle |  |
| DELETE | `{B}/services/:serviceId/photo/:photoId` |  | service photo delete | write | bundle |  |
| ? | `{B}/services/:serviceId/photo/:photoId` |  | service photo delete | ? | do weryfikacji |  |
| GET | `{B}/services/:serviceId/usage` |  | service usage | read | bundle |  |
| GET | `{B}/services/addons` | page, per_page, query, use_objects | services addons | read | bundle | `service_addons` |
| PUT | `{B}/services/addons` | page, per_page, query, use_objects | services addons | write | bundle |  |
| POST | `{B}/services/addons` | page, per_page, query, use_objects | services addons | write | bundle |  |
| GET | `{B}/services/addons/:addOnId` |  | services addons edit | read | bundle |  |
| DELETE | `{B}/services/addons/:addOnId` |  | services addons edit | write | bundle |  |
| PUT | `{B}/services/addons/:addOnId` |  | services addons edit | write | bundle |  |
| POST | `{B}/services/addons/:addOnId/photo` |  | services addons upload photo | write | bundle |  |
| DELETE | `{B}/services/addons/:addOnId/photo` |  | services addons upload photo | write | bundle |  |
| POST | `{B}/services/assign_treatment` |  | service type assign | write | bundle |  |
| POST | `{B}/services/bulk` |  | services bulk | write | bundle |  |
| DELETE | `{B}/services/bulk` |  | services bulk | write | bundle |  |
| ? | `{B}/services/bulk/from_url` |  | services bulk from url | ? | do weryfikacji |  |
| GET | `{B}/services/hints` |  | services hints | read | bundle |  |
| ? | `{B}/services/registration/bulk` |  | registration bulk | ? | do weryfikacji |  |
| POST | `{B}/services/suggest_service_types` |  | service type suggestions | write | bundle |  |
| ? | `{B}/warehouse/categories` | search_product, retail_only | warehouse commodity categories | ? | do weryfikacji |  |
| GET | `{B}/warehouse/categories` | search_product, retail_only | warehouse commodity categories | read | bundle |  |
| ? | `{B}/warehouse/commodities/update/categories` |  | update categories | ? | do weryfikacji |  |
| GET | `/business_api/service_types` | query, business_id, version | service types | read | bundle |  |

## Clients

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `{B}/business_consents` |  | businesses business consents | read | bundle |  |
| PUT | `{B}/business_consents` |  | businesses business consents | write | bundle |  |
| GET | `{B}/consent_forms` |  | consent forms | read | bundle | `consent_forms` |
| GET | `{B}/consent_forms/:formId` |  | consent forms | read | bundle |  |
| DELETE | `{B}/consent_forms/:formId` |  | consent forms | write | bundle |  |
| GET | `{B}/consents` | customer, page, per_page | consents | read | bundle | `consents_signed` |
| GET | `{B}/consents/:consentUuid` |  | consent | read | bundle |  |
| POST | `{B}/consents/:consentUuid/notify` |  | consent id notify | write | bundle |  |
| GET | `{B}/consents/:consentUuid/pdf` |  | consent id pdf | read | bundle | `report_export_batch` |
| POST | `{B}/consents/:consentUuid/send_email` |  | consent id send email | write | bundle |  |
| POST | `{B}/consents/:consentUuid/sign` | field | consent id sign | write | bundle |  |
| GET | `{B}/customer_agreements` |  | customer agreements | read | bundle |  |
| GET | `{B}/customer_groups` |  | customer groups | read | bundle | `customer_groups` |
| GET | `{B}/customer/exists` |  | customer exists | read | bundle |  |
| POST | `{B}/customers` |  | customers | write | bundle | `customer_add` |
| GET | `{B}/customers` |  | customers | read | bundle | `customer_cards` |
| ? | `{B}/customers` |  | customers | ? | do weryfikacji |  |
| ? | `{B}/customers/:businessCustomerId/invite` |  | invite | ? | do weryfikacji |  |
| PUT | `{B}/customers/:customerId` |  | business customer | write | bundle | `customer_update`, `customer_note_set` |
| DELETE | `{B}/customers/:customerId` |  | business customer | write | bundle | `customer_delete` |
| GET | `{B}/customers/:customerId` |  | business customer | read | bundle | `customer_card` |
| POST | `{B}/customers/:customerId/attached_files` |  | customer files | write | bundle |  |
| DELETE | `{B}/customers/:customerId/attached_files/:attachedFileId` |  | customer attached file | write | bundle |  |
| GET | `{B}/customers/:customerId/attached_files/:attachedFileId/download` |  | customer attached file download | read | bundle | `customer_file_download` |
| GET | `{B}/customers/:customerId/bookings` | page, per_page, inlcude_extra_bookings, state | customer bookings | read | bundle | `customer_visit_history` |
| GET | `{B}/customers/:customerId/buyers` |  | customer buyers | read | bundle |  |
| ? | `{B}/customers/:customerId/family` |  | family friends | ? | do weryfikacji |  |
| ? | `{B}/customers/:customerId/link` |  | customer link | ? | do weryfikacji |  |
| GET | `{B}/customers/:customerId/locked` | field | customer unlock field | read | bundle |  |
| GET | `{B}/customers/:customerId/med-family/relations` |  | med-family relations | read | bundle |  |
| POST | `{B}/customers/:customerId/med-family/relations` |  | med-family relations | write | bundle |  |
| DELETE | `{B}/customers/:customerId/med-family/relations/:relationId` |  | med-family relations | write | bundle |  |
| POST | `{B}/customers/:customerId/more_photos` |  | customer photos | write | bundle |  |
| DELETE | `{B}/customers/:customerId/more_photos` |  | customer photos | write | bundle |  |
| GET | `{B}/customers/:customerId/products` | page, page_size | customer products | read | bundle | `customer_product_history` |
| ? | `{B}/customers/:customerId/unlink` |  | customer unlink | ? | do weryfikacji |  |
| GET | `{B}/customers/buyers` | page, per_page | customers buyers | read | bundle |  |
| GET | `{B}/customers/by_ids` |  | customers by ids | read | bundle |  |
| ? | `{B}/customers/duplicates` |  | get duplicates | ? | do weryfikacji |  |
| POST | `{B}/customers/import` |  | import from xlsx | write | bundle |  |
| POST | `{B}/customers/import/json` |  | import json | write | bundle |  |
| GET | `{B}/customers/import/last_import` |  | last import | read | bundle |  |
| POST | `{B}/customers/manual_merge` | d | customers manual merge | write | bundle |  |
| POST | `{B}/customers/manual_merge/dry_run` |  | customers manual merge dry | write | bundle |  |
| POST | `{B}/customers/merge` |  | customer to merge | write | bundle |  |
| POST | `{B}/customers/photo` |  | business photo | write | bundle |  |
| ? | `{B}/customers/tags` |  | business tags | ? | do weryfikacji |  |
| ? | `{B}/family_and_friends/members` |  | family friends create | ? | do weryfikacji |  |
| GET | `{B}/patient_file_fields_with_options` |  | physiotherapy patient file | read | bundle |  |
| POST | `{B}/payments/onboarding_consent` |  | payments onboarding consent | write | bundle |  |

## Campaigns and messages

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/ai-receptionist-management-service/v1/business/:businessId/ai-receptionist` |  | business ai-receptionist | read | bundle |  |
| POST | `/ai-receptionist-management-service/v1/business/:businessId/ai-receptionist` |  | business ai-receptionist | write | bundle |  |
| PUT | `/ai-receptionist-management-service/v1/business/:businessId/ai-receptionist/:configId` |  | business ai-receptionist | write | bundle |  |
| GET | `/ai-receptionist-management-service/v1/business/:businessId/calls` |  | business calls | read | bundle |  |
| GET | `/ai-receptionist-management-service/v1/business/:businessId/calls/:callId` |  | business calls | read | bundle |  |
| PUT | `/ai-receptionist-management-service/v1/business/:businessId/contact-info` |  | business contact-info | write | bundle |  |
| GET | `/ai-receptionist-management-service/v1/config` |  | v1 config | read | bundle |  |
| ? | `{B}/email_templates` |  | email templates | ? | do weryfikacji |  |
| GET | `{B}/get_notification_text` | type | notification text | read | bundle |  |
| POST | `{B}/invite_again` | page, per_page, compact, page_source | invite again | write | bundle |  |
| GET | `{B}/invite_again` | page, per_page, compact, page_source | invite again | read | bundle |  |
| GET | `{B}/message_blast` | flat | message template groups | read | bundle | `campaign_groups` |
| GET | `{B}/message_blast/:templateId` | parent | single message template | read | bundle | `campaign_details` |
| PUT | `{B}/message_blast/:templateId` | parent | single message template | write | bundle |  |
| POST | `{B}/message_blast/:templateId/one_time_send` |  | onetime send | write | bundle | `campaign_send` |
| POST | `{B}/message_blast/:templateId/one_time_send_test` |  | send test | write | bundle |  |
| ? | `{B}/message_blast/activate` |  | activate modal | ? | do weryfikacji |  |
| POST | `{B}/message_blast/activate_recommended` |  | activate recommended | write | bundle |  |
| POST | `{B}/message_blast/content` |  | blast preview | write | bundle |  |
| POST | `{B}/message_blast/cost_estimation` |  | cost estimation | estimate | bundle | `campaign_estimate`, `campaign_send` |
| ? | `{B}/message_blast/counter` |  | recipients counter | ? | do weryfikacji |  |
| ? | `{B}/message_blast/group/:groupId` |  | single group | ? | do weryfikacji |  |
| POST | `{B}/message_blast/image` |  | blast custom image | write | bundle |  |
| ? | `{B}/message_blast/images` |  | template images | ? | do weryfikacji |  |
| GET | `{B}/message_blast/scheduled` |  | scheduled blasts | read | bundle | `campaign_schedule` |
| DELETE | `{B}/message_blast/scheduled/:templateId` |  | delete scheduled | write | bundle |  |
| GET | `{B}/message_blast/stop_code` |  | blast stop code | read | bundle |  |
| GET | `{B}/message_blast/template_images` | page, per_page, template_internal_name | blast template images | read | bundle |  |
| GET | `{B}/message_blast/template_images/all_images` | page, per_page | blast all images | read | bundle |  |
| GET | `{B}/message_blast/template_images/category_tree` |  | blast images tree | read | bundle |  |
| GET | `{B}/notification_list/:status` | timestamp, icon, page, per_page | notifications | read | bundle | `panel_notifications` |
| POST | `{B}/notification_list/:status` | timestamp, icon, page, per_page | notifications | write | bundle |  |
| ? | `{B}/notification_templates` |  | notification templates | ? | do weryfikacji |  |
| GET | `{B}/notifications` |  | internal notifications | read | bundle | `business_notification_settings` |
| PUT | `{B}/notifications/android/:token` |  | android token | write | bundle |  |
| DELETE | `{B}/notifications/android/:token` |  | android token | write | bundle |  |
| PUT | `{B}/notifications/email/:email` |  | internal email notification | write | bundle |  |
| DELETE | `{B}/notifications/email/:email` |  | internal email notification | write | bundle |  |
| GET | `{B}/notifications/email/:oldEmail/:newEmail/check` |  | internal emails check | read | bundle |  |
| PUT | `{B}/notifications/ios/:token` |  | ios token | write | bundle |  |
| DELETE | `{B}/notifications/ios/:token` |  | ios token | write | bundle |  |
| POST | `{B}/quick_invite` |  | quick invite | write | bundle |  |
| ? | `{B}/send_email/:templateName` |  | send email | ? | do weryfikacji |  |
| GET | `{B}/sms/management` |  | sms management | read | bundle | `campaign_sms_balance` |
| PUT | `{B}/sms/management` |  | sms management | write | bundle |  |
| ? | `{B}/sms/send/invite_customers` |  | sms invite | ? | do weryfikacji |  |
| GET | `{B}/stream_chat/call_to_actions` |  | stream chat call to actions | read | bundle | `chat_quick_actions` |
| GET | `{B}/stream_chat/config` |  | stream chat config | read | bundle |  |
| POST | `{B}/stream_chat/conversations` |  | stream chat conversations | write | bundle |  |
| POST | `{B}/stream_chat/token` |  | stream chat token | write | bundle |  |

## Reviews, marketing and profile

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `{B}/billing/boost/overdue/retry_charge` |  | boost retry charge | write | bundle |  |
| POST | `{B}/boost/claim_client` |  | claim boost client | write | bundle |  |
| POST | `{B}/boost/claim_upload_urls` |  | claim upload urls | write | bundle |  |
| GET | `{B}/boost/conditions` |  | boost conditions | read | bundle |  |
| ? | `{B}/boost/cost` |  | boost cost | ? | do weryfikacji |  |
| GET | `{B}/boost/dashboard` |  | boost dashboard | read | bundle |  |
| GET | `{B}/boost/details` |  | boost details | read | bundle |  |
| POST | `{B}/boost/enable` |  | boost enable | write | bundle |  |
| GET | `{B}/boost/preview` | filename | boost preview | read | bundle |  |
| GET | `{B}/boost/score` |  | boost score | read | bundle |  |
| POST | `{B}/boost/suspend` |  | boost suspend | write | bundle |  |
| GET | `{B}/boost/verified` |  | boost business verified | read | bundle |  |
| GET | `{B}/digital_flyer` | no_thumbs, include_awards | digital flyer | read | bundle |  |
| GET | `{B}/digital_flyer/:dfCategoryId` | no_thumbs | digital flyer category | read | bundle |  |
| GET | `{B}/digital_flyer/flyer_data` |  | flyer data | read | bundle |  |
| ? | `{B}/digital_flyer/hashtags` |  | digital flyer hashtags | ? | do weryfikacji |  |
| POST | `{B}/digital_flyer/render` |  | digital flyer render | write | bundle |  |
| POST | `{B}/digital_flyer/shared` |  | digital flyer shared | write | bundle |  |
| GET | `{B}/features_status/boost` |  | boost status | read | bundle |  |
| ? | `{B}/google_business_profile/booksy_profile` |  | google business profile booksy profile | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/complete_verification` |  | google business profile complete verification | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/gbp_accounts` |  | google business profile gbp accounts | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/gbp_location` |  | google business profile gbp location | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/gbp_location_status` |  | google business profile gbp location status | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/gbp_locations` |  | google business profile gbp locations | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/import_reviews` |  | google business profile import reviews | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/import_reviews/status/:taskId` |  | import reviews status | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/verification_options` |  | google business profile verification options | ? | do weryfikacji |  |
| ? | `{B}/google_business_profile/verify` |  | google business profile verify | ? | do weryfikacji |  |
| ? | `{B}/google_places` |  | businesses google places | ? | do weryfikacji |  |
| GET | `{B}/hints` |  | hints | read | bundle |  |
| PUT | `{B}/hints` |  | hints | write | bundle |  |
| GET | `{B}/images/v2` | category, per_page | images | read | bundle |  |
| POST | `{B}/images/v2` | category, per_page | images | write | bundle |  |
| PATCH | `{B}/images/v2/:imageId` |  | image | write | bundle |  |
| DELETE | `{B}/images/v2/:imageId` |  | image | write | bundle |  |
| GET | `{B}/images/v2/:imageId/comments` | page, per_page | image comments | read | bundle |  |
| DELETE | `{B}/images/v2/:imageId/comments/:commentId` |  | image comment | write | bundle |  |
| ? | `{B}/images/v2/:imageId/move_after` |  | image move after | ? | do weryfikacji |  |
| ? | `{B}/images/v2/:imageId/move_before` |  | image move before | ? | do weryfikacji |  |
| POST | `{B}/images/v2/:imageId/set_cover` |  | image set cover | write | bundle |  |
| GET | `{B}/images/v2/cover` |  | images cover | read | bundle |  |
| POST | `{B}/images/v2/cover` |  | images cover | write | bundle |  |
| POST | `{B}/instagram/access_token` |  | instagram access token | write | bundle |  |
| GET | `{B}/instagram/images` | access_token, limit, page_token | instagram images | read | bundle |  |
| POST | `{B}/instagram/images` | access_token, limit, page_token | instagram images | write | bundle |  |
| GET | `{B}/instagram/profile` | access_token | instagram profile | read | bundle |  |
| GET | `{B}/invoicing/cash_register_document/:documentId/preview` |  | invoicing cash register document id preview | read | bundle | `report_export_batch` |
| GET | `{B}/invoicing/invoice/:invoiceId/preview` |  | invoicing invoice id pdf | read | bundle | `report_export_batch` |
| GET | `{B}/poll` | poll_name | boost poll | read | bundle |  |
| POST | `{B}/poll` | poll_name | boost poll | write | bundle |  |
| ? | `{B}/premium_services/:promotionType` |  | premium services single | ? | do weryfikacji |  |
| GET | `{B}/premium_services/:promotionType` |  | premium services single | read | bundle |  |
| POST | `{B}/premium_services/:promotionType` |  | premium services single | write | bundle |  |
| ? | `{B}/premium_services/status` |  | tile statuses premium services | ? | do weryfikacji |  |
| GET | `{B}/premium_services/status` |  | tile statuses premium services | read | bundle |  |
| POST | `{B}/profile_completeness/steps/finish/:stepInternalName` |  | post offline step | write | bundle |  |
| GET | `{B}/profile_completeness/tiers` |  | get all steps | read | bundle |  |
| GET | `{B}/profile_completeness/tiers/active` |  | get active step | read | bundle |  |
| GET | `{B}/profile_settings_splash` |  | profile settings splash | read | do weryfikacji |  |
| POST | `{B}/profile_settings_splash/platform_fee/decision` |  | platform fee decision | write | bundle |  |
| ? | `{B}/promotions` |  | promotions | ? | do weryfikacji |  |
| POST | `{B}/promotions/:promotionType` |  | promotion single | write | bundle |  |
| GET | `{B}/promotions/:promotionType` |  | promotion single | read | bundle |  |
| DELETE | `{B}/promotions/:promotionType` |  | promotion single | write | bundle |  |
| GET | `{B}/qr_codes/business` |  | qr code business image | read | bundle |  |
| GET | `{B}/qr_codes/business_package` |  | qr code business pdf | read | bundle |  |
| GET | `{B}/qr_codes/business/generic` |  | business generic | read | bundle |  |
| GET | `{B}/reviews` | ordering, reviews_page, reviews_per_page, reviews_rank | reviews | read | bundle | `reviews_feed` |
| PUT | `{B}/reviews/:reviewId/reply` |  | reviews reply | write | bundle | `review_reply` |
| GET | `{B}/stories` | story_key | stories drawer hints | read | bundle |  |
| POST | `{B}/v2/poll` |  | poll | write | bundle |  |
| POST | `{B}/v2/polls_list` |  | polls list | write | bundle |  |
| GET | `{B}/v3/polls/booksy_pay_churn` |  | polls booksy pay churn | read | bundle |  |
| PUT | `{B}/visibility` | value_to_check | business visibility | write | bundle |  |
| GET | `{B}/visibility` | value_to_check | business visibility | read | bundle | `business_visibility` |
| GET | `{B}/visibility_promotion/dashboard` |  | visibility promotion dashboard | read | bundle |  |
| GET | `{B}/visibility_promotion/offers` |  | visibility promotion offers | read | bundle |  |
| POST | `{B}/visibility_promotion/purchase` |  | visibility promotion purchase | write | bundle |  |
| ? | `/business_api/region_hints` |  | region hints | ? | do weryfikacji |  |
| GET | `/business_api/search/street_hints` | query, advanced, only_city, only_zip | street hints | read | bundle |  |
| GET | `/business_api/search/street_hints/resolve` | location_id | street hints resolve | read | bundle |  |
| GET | `/ecommerce/v1/business/:businessId/gallery/todays-promotions/has-items` |  | todays-promotions has-items | read | bundle |  |
| GET | `/hint-and-walkthrough/v2/:country/:userId/hints` | business_id | hint and walkthrough hints list | read | bundle |  |
| POST | `/hint-and-walkthrough/v2/:country/:userId/hints/:internalName` |  | hint and walkthrough update hint status | write | bundle |  |

## Payments, checkout and registers

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `{B}/booksy_pay_onboarding_screen` |  | businesses booksy pay onboarding screen | read | bundle |  |
| POST | `{B}/loans/session` |  | loans session | write | bundle |  |
| ? | `{B}/market_pay/account/turn_on_pba` |  | turn on pba | ? | do weryfikacji |  |
| GET | `{B}/nf525/fiscal_archives` |  | fiscal archives | read | bundle |  |
| POST | `{B}/nf525/fiscal_archives/:fiscalArchiveId/url` |  | fiscal archive download | write | bundle |  |
| GET | `{B}/nf525/fiscal_receipts` |  | fiscal receipts | read | bundle |  |
| GET | `{B}/nf525/fiscal_receipts/:fiscalReceiptId` |  | fiscal receipts | read | bundle |  |
| POST | `{B}/nf525/fiscal_receipts/:fiscalReceiptId/cancel` |  | fiscal receipt cancel | write | bundle |  |
| POST | `{B}/nf525/fiscal_receipts/:fiscalReceiptId/print` |  | fiscal receipt print | write | bundle |  |
| POST | `{B}/nf525/fiscal_receipts/:fiscalReceiptId/send` |  | fiscal receipt send | write | bundle |  |
| GET | `{B}/nf525/fiscal_receipts/sale_by_basket/:basketId` |  | fiscal receipts sale by basket | read | bundle |  |
| GET | `{B}/nf525/payments_summary` |  | fiscal payments summary | read | bundle |  |
| GET | `{B}/nf525/settings` |  | certification settings | read | bundle |  |
| GET | `{B}/payments/account_details/stripe` |  | stripe payments account details | read | bundle |  |
| DELETE | `{B}/payments/account_details/stripe/payout_method/:token` |  | stripe delete payout method | write | bundle |  |
| POST | `{B}/payments/account_details/stripe/payout_method/:token/set_as_default/:payoutType` |  | stripe set default payout | write | bundle |  |
| POST | `{B}/payments/account_details/stripe/payout_methods` |  | stripe payout methods | write | bundle |  |
| GET | `{B}/payments/account_holder_settings/provider/stripe` |  | stripe account holder info | read | bundle |  |
| PUT | `{B}/payments/account_holder_settings/provider/stripe` |  | stripe account holder info | write | bundle |  |
| POST | `{B}/payments/account/stripe` |  | stripe payments stripe account | write | bundle |  |
| GET | `{B}/payments/banners` |  | stripe payments banners | read | bundle |  |
| POST | `{B}/payments/basket_payment/:basketPaymentId/refund` |  | basket payment refund | write | bundle |  |
| GET | `{B}/payments/basket_payment/:basketPaymentId/refund_fees` |  | basket payment refund fees | read | bundle | `refund_fee_preview` |
| GET | `{B}/payments/baskets/:basketId` |  | payments baskets | read | bundle | `payment_basket` |
| ? | `{B}/payments/booksy_wallet/payouts` |  | booksy wallet payouts | ? | do weryfikacji |  |
| POST | `{B}/payments/challenges/enroll` |  | challenges enroll | write | bundle |  |
| GET | `{B}/payments/challenges/status` |  | challenges status | read | bundle |  |
| ? | `{B}/payments/financial_center/overview` |  | financial center overview | ? | do weryfikacji |  |
| GET | `{B}/payments/platform_fee/:feeContext` |  | payments platform fee | read | bundle |  |
| PUT | `{B}/payments/platform_fee/:feeContext` |  | payments platform fee | write | bundle |  |
| POST | `{B}/pos/apply_tax_rate/products` |  | pos apply tax rate for products | write | bundle |  |
| ? | `{B}/pos/booking_charges` |  | pos booking charges | ? | do weryfikacji |  |
| ? | `{B}/pos/booksy_pay_settings` |  | pos booksy pay settings | ? | do weryfikacji |  |
| GET | `{B}/pos/bsx_file_link` |  | pos bsx file link | read | bundle |  |
| PUT | `{B}/pos/commissions` |  | pos commission defaults | write | bundle |  |
| ? | `{B}/pos/commissions/egifts` |  | pos commission egifts | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/egifts` |  | pos commission change egifts | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/memberships` |  | pos commission change memberships | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/packages` |  | pos commission change packages | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/mass/products` |  | pos commission change products | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/memberships` |  | pos commission memberships | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/packages` |  | pos commission packages | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/product_categories/egifts` |  | pos commission egifts categories | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/product_categories/memberships` |  | pos commission memberships categories | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/product_categories/packages` |  | pos commission packages categories | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/product_categories/products` |  | pos commission products categories | ? | do weryfikacji |  |
| ? | `{B}/pos/commissions/products` |  | pos commission products | ? | do weryfikacji |  |
| PUT | `{B}/pos/commissions/resource/:resourceId` |  | pos commission defaults resource | write | bundle |  |
| POST | `{B}/pos/fast_payout_enabled_by_merchant` |  | pos fast payout enabled by merchant | write | bundle |  |
| GET | `{B}/pos/fast_payout_enabled_by_merchant` |  | pos fast payout enabled by merchant | read | bundle |  |
| POST | `{B}/pos/fast_payout_limit` |  | stripe payout limits | write | bundle |  |
| GET | `{B}/pos/fast_payout_limit` |  | stripe payout limits | read | bundle |  |
| GET | `{B}/pos/no_show_fee_service_protection` |  | no show protection | read | bundle | `business_no_show_protection` |
| POST | `{B}/pos/no_show_fee_service_protection` |  | no show protection | write | bundle |  |
| GET | `{B}/pos/pay_by_app_info` |  | pos pay by app info | read | bundle |  |
| GET | `{B}/pos/payment_rows` | page, per_page, date_from, date_till, query | pos payment rows | read | bundle | `payment_rows` |
| GET | `{B}/pos/payment_rows_summary` |  | pos payment rows summary | read | bundle | `payment_summary` |
| GET | `{B}/pos/pos_plan_info` | pos_plan_type | pos plan info | read | bundle |  |
| ? | `{B}/pos/product_categories` |  | pos product categories | ? | do weryfikacji |  |
| GET | `{B}/pos/registers` | only_open, per_page | pos registers | read | bundle | `cash_registers` |
| POST | `{B}/pos/registers` | only_open, per_page | pos registers | write | bundle |  |
| GET | `{B}/pos/registers/:registerId` |  | pos registers | read | bundle | `cash_register` |
| POST | `{B}/pos/registers/:registerId/close` |  | pos registers id close | write | bundle |  |
| GET | `{B}/pos/registers/:registerId/direct_download` |  | pos registers id download | read | bundle | `report_export_batch` |
| ? | `{B}/pos/registers/:registerId/operations` |  | pos registers id operations | ? | do weryfikacji |  |
| GET | `{B}/pos/registers/:registerId/operations` |  | pos registers id operations | read | bundle | `cash_register_operations` |
| POST | `{B}/pos/registers/:registerId/reopen` |  | pos registers id reopen | write | bundle |  |
| GET | `{B}/pos/search_items` |  | pos search items | read | bundle |  |
| ? | `{B}/pos/transactions` |  | pos transactions | ? | do weryfikacji |  |
| DELETE | `{B}/pos/transactions/:transactionId` |  | pos transaction | write | bundle |  |
| GET | `{B}/pos/transactions/:transactionId` |  | pos transaction | read | bundle | `checkout_transaction` |
| POST | `{B}/pos/transactions/:transactionId/action` |  | pos transaction action | write | bundle |  |
| GET | `{B}/pos/transactions/:transactionId/bsx` |  | pos transaction bsx receipt | read | bundle |  |
| POST | `{B}/pos/transactions/:transactionId/bsx/log` |  | pos transaction bsx log | write | bundle |  |
| POST | `{B}/pos/transactions/:transactionId/create_invoice` |  | pos transaction create invoice | write | bundle |  |
| GET | `{B}/pos/transactions/:transactionId/last_receipt` |  | pos transaction last receipt | read | bundle | `checkout_last_receipt` |
| POST | `{B}/pos/transactions/:transactionId/print_receipt` |  | pos transaction print receipt | write | bundle |  |
| POST | `{B}/pos/transactions/:transactionId/send_receipt` |  | pos transaction send receipt | write | bundle |  |
| GET | `{B}/pos/transactions/:transactionId/splash` |  | pos transaction splash | read | bundle |  |
| POST | `{B}/stripe_sdi/integration_mode/change` |  | stripe sdi mode change | write | bundle |  |
| GET | `{B}/stripe_sdi/payment_intent/:paymentIntentId/status` |  | stripe payment intent status | read | bundle |  |
| POST | `{B}/stripe_sdi/terminal/:readerId/action/cancel` |  | stripe sdi cancel payment | write | bundle |  |
| POST | `{B}/stripe_sdi/terminal/:readerId/payment_intent/:paymentIntentId/process` |  | stripe sdi process payment | write | bundle |  |
| DELETE | `{B}/stripe/account` |  | stripe account | write | bundle |  |
| GET | `{B}/stripe/account` |  | stripe account | read | bundle |  |
| POST | `{B}/stripe/account_link` |  | stripe kyc link | write | bundle |  |
| GET | `{B}/stripe/available_balance` |  | stripe available balance | read | bundle |  |
| GET | `{B}/stripe/config` |  | stripe config | read | bundle |  |
| ? | `{B}/stripe/connection_token` |  | stripe connection token | ? | do weryfikacji |  |
| GET | `{B}/stripe/connection_token` |  | stripe connection token | read | bundle |  |
| POST | `{B}/stripe/payment_intent` |  | stripe payment intent create | write | bundle |  |
| POST | `{B}/stripe/payment_intent/:paymentIntentId/action` |  | stripe payment intent action | write | bundle |  |
| GET | `{B}/stripe/payout_account_details` |  | stripe payout account details | read | bundle |  |
| POST | `{B}/stripe/payouts/fast` |  | stripe fast payout create | write | bundle |  |
| POST | `{B}/stripe/reader` |  | stripe reader | write | bundle |  |
| PUT | `{B}/stripe/reader/:readerId/label` |  | stripe reader label | write | bundle |  |
| ? | `{B}/stripe/readers` |  | stripe readers | ? | do weryfikacji |  |
| GET | `{B}/stripe/readers` |  | stripe readers | read | bundle |  |
| GET | `{B}/stripe/terminal/hardware` |  | stripe terminal hardware | read | bundle |  |

## Invoices and billing

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| ? | `/business_api/billing_terms` |  | billing terms | ? | do weryfikacji |  |
| POST | `{B}/billing/braintree/billing_info/async` |  | billing info | write | bundle |  |
| GET | `{B}/billing/braintree/client_token` | token_only | billing braintree client token | read | bundle |  |
| POST | `{B}/billing/discount_code` |  | discount code | write | bundle |  |
| POST | `{B}/billing/grant_access_if_possible` |  | billing check access | write | bundle |  |
| GET | `{B}/billing/next_payment` |  | billing next payment | read | bundle |  |
| ? | `{B}/billing/overdue_details` |  | billing overdue details | ? | do weryfikacji |  |
| GET | `{B}/billing/payment_method` |  | billing payment method | read | bundle |  |
| GET | `{B}/billing/payment_methods` |  | billing payment methods | read | bundle |  |
| DELETE | `{B}/billing/payment_methods/:paymentMethodId` |  | billing payment method delete | write | bundle |  |
| PATCH | `{B}/billing/payment_methods/:paymentMethodId` |  | billing payment method delete | write | bundle |  |
| POST | `{B}/billing/payment_methods/:paymentMethodId/default` |  | billing payment set default | write | bundle |  |
| POST | `{B}/billing/s/payment_method/async` |  | stripe payment method | write | bundle |  |
| PUT | `{B}/billing/s/payment_method/async` |  | stripe payment method | write | bundle |  |
| GET | `{B}/billing/settings` |  | billing business settings | read | bundle |  |
| POST | `{B}/billing/settings` |  | billing business settings | write | bundle |  |
| PUT | `{B}/billing/settings/offline_migration/reminder` |  | offline migration popup | write | bundle |  |
| GET | `{B}/billing/subscription/details` |  | billing subscription details | read | bundle |  |
| GET | `{B}/billing/subscription/overdue/details` |  | billing subscription overdue details | read | bundle |  |
| POST | `{B}/billing/subscription/purchase` |  | billing subscription purchase | write | bundle |  |
| PUT | `{B}/billing/subscription/purchase` |  | billing subscription purchase | write | bundle |  |
| POST | `{B}/billing/subscription/retry/async` |  | billing retry charge | write | bundle |  |
| ? | `{B}/billing/subscription/retry/async` |  | billing retry charge | ? | do weryfikacji |  |
| GET | `{B}/billing/subscriptions/offer` |  | billing offer | read | bundle |  |
| GET | `{B}/billing/task_status/:taskId` |  | billing subscription task | read | bundle |  |
| GET | `{B}/billing/total_overdue` |  | billing overdue total | read | bundle |  |
| GET | `{B}/billing/web_based_subscription/assignment` |  | web based subscription assignment | read | bundle |  |
| GET | `{B}/invoicing/buyers` | page, per_page | invoicing buyers | read | bundle |  |
| DELETE | `{B}/invoicing/buyers/:buyerId` |  | invoicing buyers edit | write | bundle |  |
| ? | `{B}/invoicing/cash_register_document` |  | invoicing cash register document | ? | do weryfikacji |  |
| GET | `{B}/invoicing/cash_register_document/:documentId` |  | invoicing cash register document | read | bundle |  |
| DELETE | `{B}/invoicing/cash_register_document/:documentId` |  | invoicing cash register document | write | bundle |  |
| GET | `{B}/invoicing/invoice` | query, page, per_page, status | invoices | read | bundle | `invoices` |
| GET | `{B}/invoicing/invoice/:invoiceId` |  | invoicing invoice | read | bundle | `invoice` |
| DELETE | `{B}/invoicing/invoice/:invoiceId` |  | invoicing invoice | write | bundle |  |
| ? | `{B}/invoicing/invoice/:invoiceId/correction` |  | invoicing invoice id correction | ? | do weryfikacji |  |
| POST | `{B}/invoicing/invoice/:invoiceId/send_to_buyer` |  | invoicing invoice id send | write | bundle |  |
| PUT | `{B}/invoicing/seller` |  | invoicing seller | write | bundle |  |
| GET | `{B}/invoicing/seller` |  | invoicing seller | read | bundle |  |
| DELETE | `{B}/invoicing/seller` |  | invoicing seller | write | bundle |  |
| GET | `{B}/navision/documents` | page | billing invoices | read | bundle |  |
| GET | `{B}/navision/documents/:id` |  | billing invoice details | read | bundle |  |
| GET | `{B}/navision/invoice_details` |  | subscription buyer v2 | read | bundle |  |
| POST | `{B}/navision/invoice_details` |  | subscription buyer v2 | write | bundle |  |
| PATCH | `{B}/navision/invoice_details` |  | subscription buyer v2 | write | bundle |  |
| GET | `{B}/navision/settings` |  | billing navision settings | read | bundle |  |
| GET | `{B}/subscription_listing` | available | subscription listing | read | bundle |  |
| GET | `{B}/subscriptions` | limit, braintree_token, braintree_payment | subscriptions | read | bundle |  |
| GET | `{B}/subscriptions/apple/task/:taskId` |  | apple subscription task status | read | bundle |  |
| POST | `{B}/subscriptions/apple/validate` |  | apple subscription | write | bundle |  |
| ? | `{B}/subscriptions/braintree/client_token` |  | client token | ? | do weryfikacji |  |
| ? | `{B}/subscriptions/braintree/retry` |  | can retry deprecated | ? | do weryfikacji |  |
| ? | `{B}/subscriptions/braintree/retry/async` |  | can retry | ? | do weryfikacji |  |
| ? | `{B}/subscriptions/braintree/subscription/async` |  | braintree subscription | ? | do weryfikacji |  |
| ? | `{B}/subscriptions/braintree/task_status/:taskId` |  | braintree task status | ? | do weryfikacji |  |
| GET | `{B}/subscriptions/google_v4` |  | google subscription v4 | read | bundle |  |
| POST | `{B}/subscriptions/google_v4` |  | google subscription v4 | write | bundle |  |
| POST | `{B}/subscriptions/google_v4/restore` |  | google subscription restore v4 | write | bundle |  |
| ? | `{B}/subscriptions/invoice` |  | invoice | ? | do weryfikacji |  |
| ? | `{B}/subscriptions/invoice/send/:invoiceId` |  | invoice send | ? | do weryfikacji |  |
| ? | `{B}/subscriptions/listing` |  | subscription plans | ? | do weryfikacji |  |
| GET | `{B}/subscriptions/listing` |  | subscription plans | read | bundle |  |
| GET | `{B}/subscriptions/offline/request` |  | offline subscription request | read | bundle |  |
| POST | `{B}/subscriptions/offline/request` |  | offline subscription request | write | bundle |  |
| GET | `{B}/subscriptions/subscription_buyer` |  | subscription buyer | read | bundle |  |
| POST | `{B}/subscriptions/subscription_buyer` |  | subscription buyer | write | bundle |  |
| PUT | `{B}/subscriptions/subscription_buyer` |  | subscription buyer | write | bundle |  |

## Products and warehouse

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| ? | `{B}/commodity/:commodityId/warehouse/:warehouseId/history` |  | warehouse product history | ? | do weryfikacji |  |
| ? | `{B}/warehouse/barcode` |  | warehouse barcode | ? | do weryfikacji |  |
| ? | `{B}/warehouse/barcode_by_code/:code` |  | warehouse barcode by code | ? | do weryfikacji |  |
| ? | `{B}/warehouse/barcode_generator` |  | warehouse barcode generator | ? | do weryfikacji |  |
| GET | `{B}/warehouse/brands` | archived, delete_commodity | warehouse brands | read | bundle | `product_brands` |
| DELETE | `{B}/warehouse/brands` | archived, delete_commodity | warehouse brands | write | bundle |  |
| POST | `{B}/warehouse/brands` | archived, delete_commodity | warehouse brands | write | bundle |  |
| ? | `{B}/warehouse/brands` | archived, delete_commodity | warehouse brands | ? | do weryfikacji |  |
| ? | `{B}/warehouse/category` |  | warehouse commodity category | ? | do weryfikacji |  |
| POST | `{B}/warehouse/category` |  | warehouse commodity category | write | bundle |  |
| GET | `{B}/warehouse/category_tree` | query | warehouse category tree | read | bundle | `product_categories` |
| ? | `{B}/warehouse/category_tree` | query | warehouse category tree | ? | do weryfikacji |  |
| ? | `{B}/warehouse/category_tree/update` |  | category tree update | ? | do weryfikacji |  |
| GET | `{B}/warehouse/commodities` | query, page, per_page, category, retail_only | warehouse commodities | read | bundle | `product_catalog` |
| ? | `{B}/warehouse/commodities` | query, page, per_page, category, retail_only | warehouse commodities | ? | do weryfikacji |  |
| ? | `{B}/warehouse/commodities/search` |  | warehouse commodities search | ? | do weryfikacji |  |
| ? | `{B}/warehouse/commodities/update` |  | commodities update | ? | do weryfikacji |  |
| GET | `{B}/warehouse/commodity` | commodity_id | warehouse commodity | read | bundle |  |
| ? | `{B}/warehouse/commodity` | commodity_id | warehouse commodity | ? | do weryfikacji |  |
| PUT | `{B}/warehouse/commodity/archive` |  | warehouse commodity archive | write | bundle |  |
| ? | `{B}/warehouse/commodity/archive` |  | warehouse commodity archive | ? | do weryfikacji |  |
| GET | `{B}/warehouse/commodity/consumption` | business_customer_info_id, service_variant_id | warehouse commodity consumption | read | bundle |  |
| ? | `{B}/warehouse/commodity/delete` |  | warehouse commodity delete | ? | do weryfikacji |  |
| ? | `{B}/warehouse/commodity/history` |  | warehouse commodity history | ? | do weryfikacji |  |
| ? | `{B}/warehouse/document_reasons` |  | warehouse document reasons | ? | do weryfikacji |  |
| ? | `{B}/warehouse/document_rows/RW` |  | document rows RW | ? | do weryfikacji |  |
| ? | `{B}/warehouse/document_rows/WZ` |  | document rows WZ | ? | do weryfikacji |  |
| GET | `{B}/warehouse/documents` |  | warehouse documents | read | bundle | `warehouse_documents` |
| ? | `{B}/warehouse/documents` |  | warehouse documents | ? | do weryfikacji |  |
| ? | `{B}/warehouse/documents/:documentId` |  | warehouse documents | ? | do weryfikacji |  |
| ? | `{B}/warehouse/documents/:usageId` |  | warehouse documents | ? | do weryfikacji |  |
| GET | `{B}/warehouse/documents/quick_order` |  | warehouse quick order | read | bundle |  |
| ? | `{B}/warehouse/ecommerce_sync_by_commodity_barcode/:barcode` |  | warehouse ecommerce sync by commodity barcode | ? | do weryfikacji |  |
| ? | `{B}/warehouse/ecommerce_sync_by_commodity_id/:productId` |  | warehouse ecommerce sync by commodity id | ? | do weryfikacji |  |
| ? | `{B}/warehouse/ecommerce_sync_commodity_picture` |  | warehouse ecommerce sync commodity picture | ? | do weryfikacji |  |
| GET | `{B}/warehouse/internal_expenditure_reasons` |  | warehouse expenditure reasons | read | bundle |  |
| GET | `{B}/warehouse/measures` |  | warehouse measures | read | bundle |  |
| ? | `{B}/warehouse/measures` |  | warehouse measures | ? | do weryfikacji |  |
| ? | `{B}/warehouse/photo` |  | warehouse photo | ? | do weryfikacji |  |
| ? | `{B}/warehouse/stock_take/:documentId` |  | warehouse stock take | ? | do weryfikacji |  |
| GET | `{B}/warehouse/supplier` | per_page, page | warehouse supplier | read | bundle | `product_suppliers` |
| ? | `{B}/warehouse/supplier` | per_page, page | warehouse supplier | ? | do weryfikacji |  |
| ? | `{B}/warehouse/supplier/:supplierId` |  | warehouse supplier | ? | do weryfikacji |  |
| ? | `{B}/warehouse/supplies/:deliveryId` |  | warehouse supplies | ? | do weryfikacji |  |
| ? | `{B}/warehouse/unarchive_commodity` |  | warehouse unarchive commodity | ? | do weryfikacji |  |
| ? | `{B}/warehouse/usage/:usageId` |  | warehouse usage | ? | do weryfikacji |  |
| GET | `{B}/warehouse/warehouses` |  | warehouse warehouses | read | bundle | `warehouses` |
| ? | `{B}/warehouse/warehouses` |  | warehouse warehouses | ? | do weryfikacji |  |
| GET | `{B}/warehouse/warehouses/:warehouseId` |  | warehouse warehouses details | read | bundle | `warehouse_details` |
| ? | `{B}/warehouse/warehouses/:warehouseId` |  | warehouse warehouses details | ? | do weryfikacji |  |
| GET | `{B}/warehouse/warehouses/:warehouseId/commodities` | non_empty | warehouse commodities by warehouse | read | bundle |  |
| ? | `{B}/warehouse/warehouses/:warehouseId/commodities` | non_empty | warehouse commodities by warehouse | ? | do weryfikacji |  |

## Vouchers and loyalty

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/booksy-gift-cards-api/v1/bgc_splash_screen` |  | v1 bgc splash screen | read | bundle |  |
| GET | `/booksy-gift-cards-api/v1/bgc_status/:businessId` |  | v1 bgc status | read | bundle |  |
| GET | `{B}/voucher_additional_info` |  | voucher additional info | read | bundle |  |
| PUT | `{B}/voucher_additional_info` |  | voucher additional info | write | bundle |  |
| GET | `{B}/voucher_background_images` |  | voucher background images | read | bundle |  |
| GET | `{B}/voucher_orders` | per_page, type | voucher orders | read | bundle | `voucher_orders` |
| DELETE | `{B}/voucher_orders/:orderId` |  | voucher orders | write | bundle |  |
| POST | `{B}/voucher_orders/:orderId/finalize` |  | voucher orders id finalize | write | bundle |  |
| GET | `{B}/voucher_purchase_methods_settings` |  | voucher purchase methods settings | read | bundle |  |
| GET | `{B}/voucher_templates` | type, page, per_page, query_text | voucher templates | read | bundle | `voucher_templates` |
| GET | `{B}/voucher_templates/:templateId` |  | voucher single template | read | bundle |  |
| DELETE | `{B}/voucher_templates/:templateId` |  | voucher single template | write | bundle |  |
| GET | `{B}/vouchers` | page, per_page, filter, type, customer_id | vouchers | read | bundle | `vouchers` |
| PUT | `{B}/vouchers/:voucherId` |  | vouchers | write | bundle |  |
| GET | `{B}/vouchers/:voucherId` |  | vouchers | read | bundle |  |
| POST | `{B}/vouchers/:voucherId/void` |  | vouchers void | write | bundle |  |
| POST | `{B}/vouchers/simple_redeem` |  | vouchers simple redeem | write | bundle |  |
| GET | `/business_api/me/businesses/voucher_config` |  | businesses voucher config | read | bundle |  |
| POST | `/loyalty-card-service/v1/card-images/:country/:businessId` | page, per_page, sort | loyalty cards card images | write | bundle |  |
| GET | `/loyalty-card-service/v1/card-images/:country/:businessId` | page, per_page, sort | loyalty cards card images | read | bundle |  |
| GET | `/loyalty-card-service/v1/card-images/:country/:businessId/:imageId` |  | loyalty cards card images | read | bundle |  |
| GET | `/loyalty-card-service/v1/history/:country/:businessId` | page, per_page, loyalty_card_id, sort | loyalty history | read | bundle |  |
| PATCH | `/loyalty-card-service/v1/loyalty-card-programs/:country/:businessId/:cardProgramId` |  | loyalty card programs | write | bundle |  |
| GET | `/loyalty-card-service/v1/loyalty-card-programs/:country/:businessId/current` |  | loyalty card programs current | read | bundle | `loyalty_program` |
| POST | `/loyalty-card-service/v1/loyalty-card-programs/:country/:businessId/stamp` |  | loyalty card programs stamp | write | bundle |  |
| GET | `/loyalty-card-service/v1/loyalty-cards/:country/:businessId` | page, per_page, query, sort, customer_core_id | loyalty cards | read | bundle | `loyalty_cards` |
| DELETE | `/loyalty-card-service/v1/loyalty-cards/:country/:businessId` | page, per_page, query, sort, customer_core_id | loyalty cards | write | bundle |  |
| DELETE | `/loyalty-card-service/v1/loyalty-cards/:country/:businessId/:cardId` |  | loyalty cards | write | bundle |  |
| GET | `/loyalty-card-service/v1/loyalty-cards/:country/:businessId/:cardId` |  | loyalty cards | read | bundle |  |
| POST | `/loyalty-card-service/v1/loyalty-cards/:country/:businessId/:cardId/earn-reward` |  | loyalty cards id earn reward | write | bundle |  |

## Business settings and everything else

| Method | Path | Parameters | Purpose | Access | Confidence | Tool |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/upload` |  | api upload | write | bundle |  |
| POST | `/business_api/firestore/config/web` |  | config web | write | bundle |  |
| GET | `/business_api/me/businesses` |  | user businesses | read | bundle | `business_accounts` |
| POST | `/business_api/me/businesses` |  | user businesses | write | bundle |  |
| ? | `/business_api/me/businesses` |  | user businesses | ? | do weryfikacji |  |
| PUT | `{B}` |  | business | write | bundle |  |
| GET | `{B}` |  | business | read | bundle | `business_profile` |
| ? | `{B}` |  | business | ? | do weryfikacji |  |
| ? | `{B}/account_deletion` |  | business account deletion | ? | do weryfikacji |  |
| POST | `{B}/account_deletion/request` |  | account deletion request | write | bundle |  |
| ? | `{B}/activate` |  | activate business | ? | do weryfikacji |  |
| POST | `{B}/activate` |  | activate business | write | bundle |  |
| PUT | `{B}/agreements` |  | business agreements | write | bundle |  |
| GET | `{B}/agreements` |  | business agreements | read | bundle |  |
| PUT | `{B}/amenities` |  | amenities | write | bundle |  |
| GET | `{B}/amenities` |  | amenities | read | bundle | `business_amenities` |
| POST | `{B}/booksy30_feedback` |  | booksy30 feedback | write | bundle |  |
| PATCH | `{B}/business_opening_hours` |  | business opening hours | write | bundle |  |
| GET | `{B}/categorised_safety_rules` |  | businesses categorised safety rules | read | bundle | `business_booking_rules` |
| PUT | `{B}/categorised_safety_rules` |  | businesses categorised safety rules | write | bundle |  |
| GET | `{B}/check_new_geolocation` | new_geolocation | check new geolocation | read | bundle |  |
| ? | `{B}/experiment_variant/:experimentName` |  | experiments business | ? | do weryfikacji |  |
| GET | `{B}/features_status` |  | tile statuses | read | bundle | `business_features` |
| GET | `{B}/online_booking_integrations` |  | online booking integrations | read | bundle | `business_integrations` |
| POST | `{B}/online_booking_integrations/activate` |  | online booking integrations activate | write | bundle |  |
| POST | `{B}/online_booking_integrations/deactivate` |  | online booking integrations deactivate | write | bundle |  |
| GET | `{B}/partner_apps` |  | installed partner apps | read | bundle |  |
| ? | `{B}/partner_apps/:clientId` |  | installed partner app details | ? | do weryfikacji |  |
| PATCH | `{B}/partner_apps/:clientId/suspend` |  | partner app suspend | write | bundle |  |
| GET | `{B}/partner_apps/catalog` | promoted | partner apps catalog | read | bundle |  |
| GET | `{B}/partner_apps/catalog/:clientId` |  | partner app details | read | bundle |  |
| PUT | `{B}/pos` |  | pos | write | bundle |  |
| GET | `{B}/pos` |  | pos | read | bundle | `business_pos_settings` |
| ? | `{B}/pos` |  | pos | ? | do weryfikacji |  |
| GET | `{B}/referral` |  | referrals | read | bundle |  |
| POST | `{B}/referrals/page-views` |  | referrals page-views | write | bundle |  |
| PUT | `{B}/renting_venue` |  | umbrella venue | write | bundle |  |
| GET | `{B}/renting_venue/contractors` | page, per_page | umbrella venues | read | bundle |  |
| DELETE | `{B}/renting_venue/cover_photo` |  | umbrella venue cover photo | write | bundle |  |
| POST | `{B}/renting_venue/cover_photo` |  | umbrella venue cover photo | write | bundle |  |
| ? | `{B}/safety_rules` |  | safety rules | ? | do weryfikacji |  |
| GET | `{B}/search/v2/venue_search` |  | v2 venue search | read | bundle |  |
| GET | `{B}/segment/booking_counters` |  | booking counters | read | bundle |  |
| ? | `{B}/settings/banners` |  | settings banners | ? | do weryfikacji |  |
| ? | `{B}/suggest_services` |  | services suggestion 2 | ? | do weryfikacji |  |
| GET | `{B}/ttp_reminder_splash` |  | ttp reminder splash | read | do weryfikacji |  |
| GET | `/business_api/me/businesses/b_listing` | source_phone | b listing | read | bundle |  |
| POST | `/business_api/me/businesses/b_listing/:bListingId/claim` |  | b listing claim | write | bundle |  |
| GET | `/business_api/me/businesses/business_agreements` |  | agreements | read | bundle |  |
| GET | `/business_api/me/sequencing_number/:businessId/records_settings` |  | records settings | read | bundle |  |
| POST | `/business_api/me/sequencing_number/:businessId/records_settings` |  | records settings | write | bundle |  |
| GET | `/business_api/search/venue_resolver` | name, address | umbrella venue resolver | read | bundle |  |
| GET | `/business_api/search/venue_street` |  | search venue | read | bundle |  |
| POST | `/business_api/trial_claim/code` |  | trial claim code | write | bundle |  |
| POST | `/business_api/trial_claim/password` |  | trial claim password | write | bundle |  |
| POST | `/business_api/trial_claim/phone` |  | trial claim phone | write | bundle |  |
| POST | `/business_api/trial_claim/resend` |  | trial claim resend | write | bundle |  |
| POST | `/business_api/trial_claim/state` |  | trial claim state | write | bundle |  |
| GET | `/cloudfront_proxy/:proxyUrl` |  | cloudfront proxy | read | bundle |  |
| POST | `/hint-and-walkthrough/v1/walkthroughs/:country/:businessId/bgc_walkthrough/completed` |  | bgc walkthrough completed | write | bundle |  |
| GET | `/hint-and-walkthrough/v1/walkthroughs/:country/:businessId/bgc_walkthrough/viewed` |  | bgc walkthrough viewed | read | bundle |  |
| POST | `/referrals/cje` |  | referrals cje | write | bundle |  |
| POST | `/salesforce_in_app_chat_jwt` |  | salesforce in chat app jwt | write | bundle |  |
| ? | `/salesforce_in_app_chat_jwt` |  | salesforce in chat app jwt | ? | do weryfikacji |  |
