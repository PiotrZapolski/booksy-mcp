# Spec

- `booksy-mcp job`: `--exports a,b --from --to`, repeatable `--export key[:from:to]`, `--time-span`,
  `--out`, `--schedule <from> <to>`, `--schedule-out`, `--summary`, `--open-panel`, `--jitter <s>`.
- Same `Gateway` as the tools: allowlist, safe mode, shared `traffic.json`, stop after a block.
- Files: `<out>/<key>_<from>_<to>.xlsx`; schedule JSON with minutes per staff member and day.
- Summary JSON on stdout and in a file. Exit codes 0 complete, 1 partial, 2 nothing, 3 no
  extension/panel/login, 4 cooldown/block/captcha/budget. After 3 or 4 the rest is not tried.
- Port: when another booksy-mcp holds it, the job connects as a relay (HMAC proof of the shared
  pairing secret, label `booksy-mcp/relay`, no Origin header). The holder passes the calls to the
  extension in one queue with its own calls. A client without an Origin can only be a relay.
- `--open-panel`: the extension opens `https://booksy.com/pro/` in a new inactive tab of an open
  window (a minimized window when none is open) only when no panel tab exists, remembers the tab id,
  and closes only that tab at the end.
- `--jitter`: random wait of 0 to N seconds before the first request; gaps stay random as in safe mode.
- Removed: `maxBackgroundMs`, the `idle` permission, `guard.ts`, `panel_in_background`.
