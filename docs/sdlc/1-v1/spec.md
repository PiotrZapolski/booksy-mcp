# Spec: public MCP server for Booksy Biz through the user's browser (#1)

Intent: [intent.md](intent.md)

## Behaviour

Three parts, all local:

1. **Chrome extension (MV3)** with no content script. For each call the background worker runs one
   short function in the panel tab with `chrome.scripting.executeScript({world: 'MAIN'})`. The
   function reaches the panel's own Vuex store and calls its `api/call` action.
2. **Local MCP server** (TypeScript, official SDK, stdio, started by the MCP client). It owns the
   tools, the policy, the queue, the cache and the confirmations.
3. **Bridge**: a WebSocket on `127.0.0.1` from the extension to the server, with pairing.

### How requests are made

The panel keeps its access token in a cross-origin gateway frame and restores it into store memory.
Three options were considered:

| Option | Verdict |
| --- | --- |
| Dispatch the panel's own `api/call` action | **Chosen.** The panel's client adds its headers, picks the host and runs its interceptors. Our code never reads the token. |
| Hook `XMLHttpRequest.setRequestHeader` and replay headers | Rejected: our code would hold the token, and it needs a permanent patch of the page. |
| Read the token from the store and call `fetch` | Rejected: same token handling, and we would have to rebuild the panel's URL and header logic. |

The page function reads only `app.country`, `app.language`, `business.business` (id, name, timezone)
and `identity.user` (id, access level). It never reads `identity.accessToken`. It returns
only status, data and two headers, never the axios `config` object.

### Bridge transport

WebSocket instead of native messaging. Native messaging needs a host manifest in a per-OS location
(a registry key on Windows) and a second process, because Chrome starts the host and the MCP client
starts the server, so a local socket would be needed anyway. `npx` plus a loaded extension is the
shortest setup a salon owner can follow. The costs of a local port are handled explicitly:

- listens on `127.0.0.1` only, default port 47821;
- `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding);
- `Origin` must be the pinned `chrome-extension://<id>` (web pages cannot connect);
- first connection needs a one-time 8-character code, valid 10 minutes, 5 attempts, then rotated;
- pairing creates a 32-byte secret; later connections use mutual HMAC challenge-response, so a
  process squatting on the port gets no secret and cannot issue commands;
- one authenticated connection at a time, 64 MB frame limit.

### Traffic policy

- FIFO queue, one request in flight, at least 2 s between requests plus up to 50% jitter. The
  configured gap cannot go below 1 s.
- Hourly budget, default 300 requests.
- Read cache: 60 s default, 5 min for catalogues, 10 min for statistics.
- No automatic retries. 429 or a block or captcha answer opens a 15-minute breaker. Three plain 403
  in a row do the same. 401 reports "log in to the panel".
- Multi-window work (ranges over 31 days, batch exports) goes through the same queue one by one.

### Endpoint policy

`src/shared/allowlist.ts` is the single list of rules. A rule has an id, method, path template and
kind (`read`, `estimate`, `write`). Tools refer to rules by id. The wire protocol carries the rule
id and parameter values, not a URL, so nothing outside the list can be expressed. The extension
bundles the same file and resolves the rule again. Parameter values must match
`^[A-Za-z0-9_-]{1,128}$`.

`estimate` rules are POSTs the panel uses to calculate something without changing data.

### Writes

- All write tools are disabled and not even registered unless named in the configuration.
- Tools that reach clients (`campaign_send`, `chat_reply`) are excluded from `all` and must be
  named one by one.
- Every write has `mode: dry_run` (default) or `mode: confirm`. A dry run builds the exact request,
  calls the panel's own preview endpoint where there is one, and returns a `confirm_token`.
- The token is an HMAC over the tool name and canonical request, single use, 5 minutes. Confirming
  with different arguments fails.
- If the MCP client supports elicitation, the user is also asked directly before the request goes.
- The extension has its own "allow writes" switch, off by default.
- Appointment tools require an explicit `notify_customer` value: nothing messages a client by
  default.
- A path protected by the panel's captcha configuration is refused before the request is made.

### Tools

Names follow Booksy's own resources: `<resource>_<action>`. The list lives in `src/tools/` and in
the README. Coverage: session, business profile and settings, opening hours, calendar and
appointments, open slots, appointment change feed, staff and stations, shifts to the minute, time
off and time blocks, services and add-ons, clients, campaigns and automated campaigns, chat,
reviews, statistics and reports, report exports, documents, payments, deposits, refund fee previews,
cash registers, wallet, invoices, products and warehouse, notifications, vouchers, consents,
loyalty.

### Exports

`report_export` calls the panel's report download with a binary response, saves the file under the
export directory with mode 0600 and can parse it to JSON or convert it to CSV locally.
`report_export_batch` does this for several report keys in sequence. Report keys come from the
panel at run time (`stats_report_catalog`), because the panel does not hard-code them.

### Change feed

`appointment_changes_feed` reads the calendar for a window, compares it with a local snapshot and
returns new, moved, cancelled and otherwise changed appointments. The snapshot stores only the
appointment id, status, start, end and staff id, in mode 0600.

## Edge cases

- No panel tab, tab discarded, panel still loading, logged out, or the extension not paired: a
  specific error that says what the user should do. The extension never opens tabs by itself.
- Several panel tabs: the active one wins, otherwise the most recently used.
- Salon switched in the panel: every result carries the business id, the cache key includes it.
- A second MCP client on the same port: the second server stays up and its tools explain the conflict.
- Service worker restart: the worker reconnects on an alarm and resumes with the stored secret.
- Large results are written to a file, and the tool returns the path and a preview.
- A date range over 31 days is split, read in sequence and merged without duplicates.
- Empty report or unknown key: returned as Booksy's own error, without retry.

## Policies

- **Security and access:** no session token handled. Tokens in any response are redacted on the
  server side. The bridge secret is the only secret, stored with mode 0600. Logs hold no client data.
- **Data:** client data flows only to the user's MCP client. Exports and snapshots stay on the
  user's disk. `BOOKSY_MCP_MASK_CONTACTS=1` masks phones and e-mails in tool output.
- **Money:** read only. Refund, charge, payout and billing endpoints are not in the allowlist, apart
  from the read-only refund fee preview.
- **Clients:** messaging tools are off, named individually, and always previewed first.

The owner asked for this change directly, including the write tools and their limits, so it follows
the normal merge rule.
