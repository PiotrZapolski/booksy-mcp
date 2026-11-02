# Plan: public MCP server for Booksy Biz through the user's browser (#1)

Spec: [spec.md](spec.md)

## Files

| Path | Change |
| --- | --- |
| `src/shared/` | allowlist and wire protocol, used by the server and the extension |
| `src/bridge/` | WebSocket server, pairing, mutual authentication |
| `src/gateway/` | queue, cache, breaker, response cleaning, request flow |
| `src/domain/` | date windows, open slots, change feed |
| `src/writes/` | dry-run and confirmation tokens |
| `src/exports/` | saving files, xlsx reader, CSV conversion |
| `src/tools/` | tool definitions |
| `extension/` | MV3 extension: background worker, page function, popup |
| `docs/` | endpoint catalogue, live verification list, this record |
| `.github/workflows/` | fast PR lane |
| `server.json`, `README.md`, `LICENSE` | listing metadata, docs, MIT licence |

## Steps

- [x] 1. Static analysis of the panel's public JavaScript; catalogue of endpoints.
- [x] 2. Tests for allowlist, queue, cache, breaker, pairing, confirmation tokens, page function.
- [x] 3. Shared policy, bridge, gateway.
- [x] 4. Extension.
- [x] 5. Tools, write gating, exports, change feed, open slots.
- [x] 6. README, verification list, `server.json`, CI.
- [x] 7. Tests, lint, typecheck, build, diff review, PR.

## Tests

Unit tests with synthetic fixtures in `test/`. Commands for the PR: `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build`. CI runs the same on the fast lane.

The bridge test starts a real WebSocket server on a random local port and connects with wrong
origin, wrong host, wrong code and wrong proof. The page function test uses a fake store whose
responses carry an access token in `config.headers`, and asserts it never reaches the result.

No test talks to Booksy. Nothing is checked against the live panel until the live verification
(`docs/verification.md`).

## Risks

| Risk | Detection | Response |
| --- | --- | --- |
| Booksy changes the panel's store or `api/call` | `panel_not_ready` from every tool | Fix the page function, release |
| An endpoint or field differs from the bundle reading | Live verification, tool errors | Update the rule or the mapping |
| Account action by Booksy | Breaker, documented risk | User stops; the tool does not retry |
| Field names for open slots or the feed differ | Live verification | Mapping lives in `src/domain/` |
| Unpacked extension id changes | Pinned `key` in the manifest | `BOOKSY_MCP_EXTENSION_ID` override |

Rollback: revert the PR. Nothing here touches a server or stored production data.

## Deviations

- The endpoint catalogue is marked `bundle` or `do weryfikacji`: no live confirmation is possible from the
  build environment, so nothing is called confirmed yet.
- `exceljs` was dropped for a small local xlsx reader on `fflate`. It pulled in about 440 extra
  packages and open advisories for a read-only need.
- Opening hours are read only in v1. Saving them in the panel is a two-step flow that also adjusts
  staff working hours; a wrong call would change every staff schedule, so it needs a live test first.
- Chat bodies live at a third-party chat provider, reachable only through a chat token issued by
  Booksy. That token is requested and used inside the tab function and never leaves it. This is the
  one place the project handles a token, and it is not the panel session token. Chat tools are
  marked `do weryfikacji`.
- CI is one fast workflow on GitHub-hosted runners. The whole suite runs in seconds, so a separate
  full-test workflow adds nothing. The repository is meant to go public, and the team's merge queue
  uses shared workflows from a private repository, which a public repository cannot call.
