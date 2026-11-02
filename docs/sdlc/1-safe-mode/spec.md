# Spec: safe mode and fixes after the live look at the panel (#1)

Intent: [intent.md](intent.md)

## Safe mode

`TrafficPolicy` in `src/config.ts` holds every threshold. `SAFE_TRAFFIC` is the default,
`UNRESTRICTED_TRAFFIC` applies only after `BOOKSY_MCP_SAFE_MODE` of `0`, `false`, `off` or `no`, or
`"safeMode": false`. Any other value stays safe, because a typo must not lower protection. The older
gap and budget settings can only tighten safe mode, and apply as set with it off.

Where each rule lives:

| Rule | Place |
| --- | --- |
| Sequence, gaps, budgets | `SequentialLimiter` with read, write and export kinds |
| Budgets and cooldown across restarts | `TrafficLedger`, file `traffic.json` in the state folder |
| Stop on 403, 429, captcha, `request_blocked` | `Breaker`, with no strikes: one signal stops |
| Requests per tool call | `Gateway.scope` with `AsyncLocalStorage`, wraps each tool call |
| Range limits | `Gateway.assertRange`, before anything is sent |
| Pauses between windows and weeks | `Gateway.pause`, skipped after a cache hit |
| Cache | `cacheMultiplier`, `minFreshSeconds` in the gateway |
| Unattended panel | `extension/src/guard.ts`, refused in the extension before injection |

Decisions worth knowing:

- Persistence is needed: MCP clients start a new server per session, so memory-only budgets and
  cooldowns would be reset constantly.
- A plain 403 stops at once, as asked, but for 1 h and not 6 h: it can also mean this login has no
  access to a screen.
- `booksy-mcp reset-cooldown` is a CLI command and no tool, so an assistant cannot lift a stop. A
  running server rereads an active block from the file, so it works without a restart.
- Gaps count from the end of the previous request. Reports can take minutes, so counting from the
  start would give no gap at all.
- Chat counts as 3 requests: config, token and the chat call.
- Idle detection (`chrome.idle`) and `tab.lastAccessed` need `idle` and Chrome 121. `idle` shows no
  permission warning.

## Live findings

Parameters: `calendar_month` sends `resource_id` for each resource and `resources_per_page`.
`customer_visit_history` gets `state` and the panel's `inlcude_extra_bookings`. Reviews, customers
and notifications already matched. The host `pl.booksy.com/core/v2` needs nothing in the code or in
`host_permissions`, because the panel page makes those requests.

## The report frame

Three ways were considered:

| Option | Verdict |
| --- | --- |
| Run requests inside the frame | Rejected. The frame's client is private to its module, so this means reading the token or copying headers. Project rule since v1. |
| A store action in the frame | Rejected. Its Pinia stores only load `identity`, `business`, `config`. Report calls are private functions. |
| `{S}` through the panel's own client in the main tab | **Chosen.** The download button works exactly so, by `downloadFromApi`. Same API, works from any screen, no token. |

Unknown until checked live: the frame reads through `/api/{country}/2/`, the panel through
`/core/v2`. The download proves `/core/v2` for `{S}/report/download` only. `docs/verification.md`
has the check, and `stats_frame_requests` shows the frame's real addresses without touching the token.
