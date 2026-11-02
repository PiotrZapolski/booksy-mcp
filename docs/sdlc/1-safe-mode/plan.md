# Plan: safe mode and fixes after the live look at the panel (#1)

Spec: [spec.md](spec.md)

## Files

- `src/config.ts`: thresholds and the switch. `src/gateway/ledger.ts`: new.
- `src/gateway/`: limiter, breaker, cache, gateway. `src/shared/`: protocol and `report` on rules.
- `src/tools/`: ranges, pauses, batch limit, `calendar_month`, `customer_visit_history`,
  `stats_frame_requests`.
- `extension/`: `guard.ts`, `pageFrameRequests`, manifest.
- `README.md`, `docs/endpoints.md`, `docs/verification.md`.

## Tests

- `test/config.test.ts`: default, explicit off, typos stay on, tightening only, README lists all.
- `test/gateway.test.ts`: both modes for stop signals, restart, reset, budgets, page limit, cache.
- `test/limiter.test.ts`, `test/page.test.ts`, `test/tools.test.ts`: gaps, frame shapes, unattended
  rule, windows, parameters.

## Risks

- `{S}` reads may not work on `/core/v2`: see the report frame in `docs/verification.md`.
- 20 minutes of a hidden tab stops a long unattended job. That is the point of safe mode.
- `tab.lastAccessed` in a minimized window is not confirmed. If it is old, the tool stops early.

## Odstępstwa

The brief proposed running requests in the stats frame. Not done: the bundle shows this needs the
session token. The extension does get access to the frame, read-only, for `stats_frame_requests`.
