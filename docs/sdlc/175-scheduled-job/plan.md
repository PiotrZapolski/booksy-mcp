# Plan

1. Remove the unattended rule: config, protocol, gateway, extension, manifest, tests, README.
2. Protocol: relay messages, `open_panel`, `close_panel`. Bridge server: relay auth, one queue.
3. `src/bridge/relay.ts`: relay client. Ledger rereads the file before each change.
4. Gateway: `openPanel` (waits for the panel to be ready), `closePanel`.
5. `src/job.ts` and the `job` command in `src/index.ts`.
6. Tests: `test/job.test.ts`, relay cases in `test/bridge.test.ts`. README section "Scheduled jobs".

Risk: the panel home address may redirect differently per country; the job waits up to 90 s for
the panel store and stops with exit 3 if it never appears.
