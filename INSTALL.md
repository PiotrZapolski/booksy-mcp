# Install booksy-mcp (instructions for an AI agent)

You are an AI agent (Claude Code, Codex or Claude Desktop) installing booksy-mcp for a salon owner. Do the steps in order. Run commands yourself. Ask the user to act only in steps marked USER. Speak the user's language. Keep messages short.

## 1. Check requirements

Run `node --version`. It must be v20 or newer. If not, tell the user to install Node.js 20+ from https://nodejs.org and stop.

Chrome 121 or newer must be installed. You cannot check it reliably, so ask once: "Do you use Google Chrome on this computer?" If not, stop and say Chrome is required.

## 2. Get the code

booksy-mcp is not on npm yet. Use a clone:

```sh
git clone https://github.com/PiotrZapolski/booksy-mcp.git ~/booksy-mcp-src
cd ~/booksy-mcp-src && npm ci && npm run build
```

If the folder exists, run `git pull` instead of `git clone`. (After npm publication, replace `node ~/booksy-mcp-src/dist/index.js` below with `npx -y booksy-mcp`.)

## 3. Run setup

First a preview. It changes nothing:

```sh
node ~/booksy-mcp-src/dist/index.js setup --dry-run
```

Read the output. Then run the real thing (add `--client claude-code|codex|claude-desktop` to pick one client):

```sh
node ~/booksy-mcp-src/dist/index.js setup
```

Setup adds the `booksy` server to every detected client, keeps other entries, saves a backup next to each edited file (`*.booksy-mcp.bak`), copies the extension to `~/booksy-mcp/extension` and tries to open `chrome://extensions` and that folder. It makes no network calls.

If it prints `failed`, show the user the message and stop. If it says no client was configured, ask which client they use and rerun with `--client`.

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

Call `business_profile`. It must return the salon name from the open panel. Tell the user which salon you see and ask whether it is the right one. Done. Suggest a first question, for example today's calendar.

Rules to follow from now on: the tool paces requests on purpose (safe mode). Do not try to speed it up or work around a cooldown or a captcha. Write tools are off by default and the user enables them (see README, Writes).

## Problems

| Symptom | Fix |
| --- | --- |
| No `booksy` tools in the client | Restart the client or `/mcp` reconnect. Check with `claude mcp list` or the client's config file. |
| `bridge_not_connected` | Chrome must be open with the extension loaded and enabled. Tools wait up to 12 s for it. Check `chrome://extensions`, then call `session_status` again. |
| `bridge_port_busy` | Another client runs booksy-mcp. Close it, or set `BOOKSY_MCP_PORT` for the server and the same port in the extension popup. |
| No pairing code, not connected | Already paired in the past. Run `node ~/booksy-mcp-src/dist/index.js reset-pairing`, restart the client, call `session_status`. |
| Code rejected | Codes last 10 minutes and allow 5 tries. Call `session_status` for a fresh one. |
| No panel tab / `tab_missing` | The user must open https://booksy.com/pro in Chrome and log in. |
| Panel in background | Ask the user to bring the panel tab to the front once. |
| Cooldown after a block | Stop. Tell the user. Booksy asked to slow down. After the time shown, check the panel works by hand, then `reset-cooldown` only if the user agrees. |

## Uninstall

```sh
node ~/booksy-mcp-src/dist/index.js setup --uninstall
```

Then the user removes **Booksy MCP Bridge** in `chrome://extensions` and restarts the client.
