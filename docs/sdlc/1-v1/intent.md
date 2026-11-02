# Intent: public MCP server for Booksy Biz through the user's browser (#1)

## Problem

Salon owners on Booksy keep their calendar, clients, payments and reports in a panel that has no
self-serve API. Getting that data into an assistant means clicking through the panel or downloading
spreadsheets by hand. Moving the panel session to a script or a server is not acceptable: it takes
the session token out of the browser, which is the one thing that protects the salon's account and
its clients' data.

## Who it is for

Owners and managers of salons on Booksy who use an MCP client (Claude Code, Claude Desktop, Codex)
and want to ask about their own business. They run a Chrome extension and a local server on their
own computer. They are not developers, so the setup has to be short and the failure messages have
to say what to do.

## Success

- An assistant can read calendar, staff schedules to the minute, services, clients, reviews,
  statistics, payments, products and every downloadable report of the logged-in salon.
- No session token is read, copied or stored by this project. Every request is executed by the
  panel's own HTTP client inside the user's panel tab.
- Requests are sequential, spaced, cached and limited to a fixed list of endpoints the panel calls.
- Writes are off by default, can be enabled tool by tool, and each one needs a dry run and a
  confirmation.
- `docs/endpoints.md` catalogues what the panel's public JavaScript shows, with a confidence value
  for each entry, and `docs/verification.md` lists what must be confirmed in a live panel.

## What we do not do

- No token export, no impersonated TLS or HTTP/2 fingerprint, no captcha or anti-bot bypass.
- No hosted service. Nothing runs anywhere except the user's own computer and browser.
- No login, password, 2FA, billing or payment-method changes, money movement or refunds.
- No publishing in this change: npm, MCP Registry, Chrome Web Store and repository visibility stay
  as they are.
- No integration code for private systems of the maintainer.
