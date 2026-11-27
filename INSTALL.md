# Install booksy-mcp (instructions for an AI agent)

You are an AI agent (Claude Code, Codex or Claude Desktop) installing booksy-mcp for a salon owner. Do the steps in order. Run commands yourself. Ask the user to act only in steps marked USER. Speak the user's language. Keep messages short.

## 1. Check requirements

Run `node --version`. It must be v20 or newer. If not, tell the user to install Node.js 20+ from https://nodejs.org and stop.

Chrome 121 or newer must be installed. You cannot check it reliably, so ask once: "Do you use Google Chrome on this computer?" If not, stop and say Chrome is required.

## 2. Get the server

The server is the npm package `booksy-biz-mcp`. `npx -y booksy-biz-mcp` downloads and runs it, so there is nothing to clone or build. Never install the npm package named `booksy-mcp`: it belongs to someone else and is not this project.

Check that npx reaches the package. It must print a version:

```sh
npx -y booksy-biz-mcp --version
```

If npm is blocked on this computer, use the fallback in "Build from source" at the end and replace `npx -y booksy-biz-mcp` below with `node ~/booksy-mcp-src/dist/index.js`.

## 3. Run setup

First a preview. It changes nothing:

```sh
npx -y booksy-biz-mcp setup --dry-run
```

Read the output. Then run the real thing (add `--client claude-code|codex|claude-desktop` to pick one client). The assistant gets the 37 core tools by default (calendar, staff, services, clients, reviews, reports). Only if the user asks for more, add `--groups payments,inventory,vouchers,marketing,business` (any subset) or `--groups all`; without `--groups` an existing configuration is left as it is:

```sh
npx -y booksy-biz-mcp setup
```

Setup adds the `booksy` server to every detected client (each will start it with `npx -y booksy-biz-mcp`), keeps other entries, saves a backup next to each edited file (`*.booksy-mcp.bak`), copies the Chrome extension from the npm package to `~/booksy-mcp/extension` and tries to open `chrome://extensions` and that folder. Setup itself makes no network calls. npx downloads the package from npm.

If it prints `failed`, show the user the message and stop. If it says no client was configured, ask which client they use and rerun with `--client`.

If the extension folder is missing later, `npx -y booksy-biz-mcp extension ~/booksy-mcp/extension` copies it again and prints the path. The same extension is the file `booksy-mcp-extension-<version>.zip` on https://github.com/PiotrZapolski/booksy-mcp/releases/latest.

## 4. USER: load the extension

Tell the user exactly this, then wait for "done":

1. In Chrome, open `chrome://extensions` (type it in the address bar if it did not open).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder `<the extension path printed by setup>`.
4. Pin the **Booksy MCP Bridge** icon (puzzle icon, then the pin).

## 5. USER: reconnect the MCP client

The client reads its server list only on start. Tell the user:

- Claude Code: run `/mcp`, pick `booksy`, reconnect (or restart `claude`).
- Codex and Claude Desktop: quit the app fully and start it again.

After a restart this conversation may end. Tell the user to paste the same install sentence again, and continue from step 6.

## 6. USER: open the panel

Ask the user to open https://booksy.com/pro in Chrome, log in and leave that tab open.

## 7. Pair

Call the tool `session_status`.

- `bridge.connected: true`: already paired, go to step 8.
- `bridge.pairingCode` is set: tell the user "Click the Booksy MCP Bridge icon, type this code: `<code>`, click Connect." Wait for "done". The code is valid 10 minutes. Then call `session_status` again. It must show `bridge.connected: true`.
- Tool `booksy` is missing: step 5 was not done. Repeat it.

## 8. Test

Call `session_status` again. Its `panel` field must show the salon name from the open panel. Tell the user which salon you see and ask whether it is the right one. Done. Suggest a first question, for example today's calendar.

Rules to follow from now on: the tool paces requests on purpose (safe mode). Do not try to speed it up or work around a cooldown or a captcha. Write tools are off by default and the user enables them (see README, Writes). When a tool the user asks for is missing, `session_status` (`tool_groups`) says which tool group to turn on (see README, Tool groups).

## Problems

| Symptom | Fix |
| --- | --- |
| No `booksy` tools in the client | Restart the client or `/mcp` reconnect. Check with `claude mcp list` or the client's config file. |
| One tool is missing, or the error `tool_group_disabled` | Its tool group is off. `session_status` lists the groups. Turn one on with `npx -y booksy-biz-mcp setup --groups <group>` or `"toolGroups"` in `~/.config/booksy-mcp/config.json`, then restart the client. |
| `bridge_not_connected` | Chrome must be open with the extension loaded and enabled. Tools wait up to 12 s for it. Check `chrome://extensions`, then call `session_status` again. |
| `bridge_port_busy` | Another client runs booksy-mcp. Close it, or set `BOOKSY_MCP_PORT` for the server and the same port in the extension popup. |
| No pairing code, not connected | Already paired in the past. Run `npx -y booksy-biz-mcp reset-pairing`, restart the client, call `session_status`. |
| Code rejected | Codes last 10 minutes and allow 5 tries. Call `session_status` for a fresh one. |
| No panel tab / `tab_missing` | The user must open https://booksy.com/pro in Chrome and log in. |
| Cooldown after a block | Stop. Tell the user. Booksy asked to slow down. After the time shown, check the panel works by hand, then `reset-cooldown` only if the user agrees. |

## Uninstall

```sh
npx -y booksy-biz-mcp setup --uninstall
```

Then the user removes **Booksy MCP Bridge** in `chrome://extensions` and restarts the client.

## Build from source (fallback)

Only when npx cannot be used:

```sh
git clone https://github.com/PiotrZapolski/booksy-mcp.git ~/booksy-mcp-src
cd ~/booksy-mcp-src && npm ci && npm run build
```

If the folder exists, run `git pull` instead of `git clone`. Then use `node ~/booksy-mcp-src/dist/index.js` wherever this file says `npx -y booksy-biz-mcp`. Setup run this way registers the local build in the clients.
