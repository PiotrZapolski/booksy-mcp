# Intent: safe mode and fixes after the live look at the panel (#1)

## Problem

v1 had one fixed traffic setup: a gap, an hourly budget, a 15-minute stop. An MCP client restart
reset all of it, and nothing limited a day, a report export or a long date range. A first passive
look at a real panel also showed parameters that differ from the code, and that statistics run in a
cross-origin frame, which v1 did not take into account.

## Who it is for

Salon owners whose business depends on their Booksy account. They should get the careful setup
without configuring anything.

## Success

- One switch, on by default. Off only when said in so many words, with a warning.
- All thresholds in `src/config.ts`, documented in the README, visible in `session_status`.
- 403, 429, captcha and `request_blocked` stop everything at once, in both modes, with no retry.
- `docs/endpoints.md` shows what was seen live, the code uses the parameter names the panel uses.
- It is clear how statistics reach the API, and what is still to be checked live.

## What we do not do

- No handling of the session token, also not for the report frame.
- No requests from the agent server to Booksy. The bundle analysis used a local copy from v1.
- No new endpoints in the allowlist.
- No publishing: npm, Web Store and repository visibility stay as they are.
