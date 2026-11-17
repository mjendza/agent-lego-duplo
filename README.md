# agent-lego-agent-mcp

Drive a **LEGO DUPLO train** (Train Base hub from the DUPLO Push & Go / Steam / Cargo sets, e.g. 10874, 10875, 10427, 10428) from **Claude Code**.
It works through an MCP server built on [node-poweredup](https://github.com/nathankellenicky/node-poweredup) over Bluetooth Low Energy.

```
Claude Code ──stdio/MCP──> src/server.js ──> src/train.js ──node-poweredup──BLE──> DUPLO train
```

## 1. Requirements

| | |
|---|---|
| OS | Windows 10/11 (tested on Windows 11). macOS and Linux also work with node-poweredup. |
| Bluetooth | A **Bluetooth LE (4.0+)** adapter. Built-in laptop Bluetooth is fine. |
| Node.js | **20 or newer** (tested on 24). |
| Claude Code | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` |
| Train | DUPLO train with fresh AA batteries |

## 2. Install

```powershell
git clone https://github.com/mjendza/agent-lego-agent-mcp.git
cd agent-lego-agent-mcp
npm install
npm run check:ble      # should print: Bluetooth state: poweredOn / OK
```

npm 11 may warn that `@stoprocent/noble` has install scripts that were not approved.
You can ignore this: the package ships a prebuilt Windows binary (`prebuilds/win32-x64`), so nothing has to compile.
If `check:ble` prints `poweredOn`, the Bluetooth stack works.

## 3. Bluetooth: connecting the train

You don't pair the train in Windows. The library finds it over BLE and connects to it directly.

1. **Turn on Bluetooth** in Windows: *Settings → Bluetooth & devices → Bluetooth: On*.
2. **Do NOT pair the train** in Windows Settings. If you already did, open *Bluetooth & devices*, find the "Train Base" device and click **Remove device**. A paired train often won't connect.
3. **Close the LEGO DUPLO Connected Train app** on any phone or tablet nearby. The hub accepts only **one** connection at a time.
4. **Wake the train:** press the **green button** on top of the locomotive. The light on the train starts **blinking**, which means it is waiting for a connection.
5. Connect from Claude Code with `/train-connect`. Any other command also connects automatically. When it connects, the light stops blinking.
6. The train powers off by itself after a few minutes of inactivity. When that happens, press the button again.

To test the hardware without Claude:

```powershell
npm run scan     # find + connect + print name/battery, then disconnect
npm run smoke    # connect, horn, green light, drive 2 s, brake, disconnect
```

## 4. Use from Claude Code

```powershell
cd agent-lego-agent-mcp
claude
```

The project includes these config files:

- `.mcp.json` registers the MCP server `duplo-train` (`node src/server.js`).
- `.claude/settings.json` pre-approves that server (`enabledMcpjsonServers`) and allows its tools (`mcp__duplo-train`), so you don't get a prompt on every horn.
  On the first start, Claude Code may still ask you to trust the folder or approve the project MCP server. Answer yes.
- `.claude/commands/*.md` defines the slash commands below.

Check that the server is running with `/mcp`. `duplo-train` should show as *connected* with 9 tools.

### Slash commands

| Command | What it does | MCP tool |
|---|---|---|
| `/train-connect [timeout]` | Tells you to press the button, then scans and connects | `connect` |
| `/horn` | Toot toot! | `horn` |
| `/train-start [speed] [forward\|backward]` | Start or change speed (0–100, default 50). Takes `slow` or `fast` too | `start` |
| `/train-stop [coast]` | Brake (default) or coast to a stop | `stop` |
| `/train-status` | Connected?, battery %, current power | `status` |
| `/train-disconnect` | Stop and disconnect | `disconnect` |

### Horn hook: the train honks when Claude needs you

`.claude/settings.json` sets up two hooks, `Stop` (Claude finished its turn) and `Notification` (Claude is waiting for a permission or your input).
Both call the MCP tool `horn` with `onlyIfConnected: true`. They use the `mcp_tool` hook type, so the call goes through the MCP server that already holds the Bluetooth connection.

- The horn only sounds after the train is connected (`/train-connect` once per session). When the train isn't connected, the hook does nothing and doesn't scan, so Claude never waits on it.
- To turn the hooks off, delete the `hooks` block from `.claude/settings.json`, or review them in `/hooks`.

### Natural language

The tools are available to Claude directly, so you can also just ask:

> "Connect to the train, blow the horn twice, drive forward at 40 for 5 seconds, then make the water refill sound and turn the light blue."

### MCP tools

| Tool | Arguments |
|---|---|
| `connect` | `timeoutSeconds` (5–120, default 30), `name` (optional hub name) |
| `disconnect` | – |
| `status` | – |
| `horn` | – |
| `play_sound` | `sound`: `HORN`, `BRAKE`, `STATION_DEPARTURE`, `WATER_REFILL`, `STEAM` |
| `start` | `speed` 0–100, `direction` `forward`/`backward` |
| `drive` | `speed`, `direction`, `seconds` (≤ 60), then brakes |
| `stop` | `brake` (default `true`) |
| `set_light` | `color`: `BLACK, PINK, PURPLE, BLUE, LIGHT_BLUE, CYAN, GREEN, YELLOW, ORANGE, RED, WHITE, NONE` |

All action tools connect automatically if the train isn't connected yet.
When Claude Code exits, the server stops the motor and disconnects.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `No DUPLO train found within 30 s` | Press the green button (the light must blink). Unpair the train in Windows. Close the LEGO app. Change batteries. Move closer. |
| `check:ble` never reaches `poweredOn` | Bluetooth is off, or the adapter doesn't support BLE. Toggle Bluetooth off and on, or use a BLE 4.0+ USB dongle. |
| Train doesn't move at low speed | DUPLO motors need about 20–30 % power to start. |
| First horn is silent | Run it again. The server waits 500 ms after connecting, but the hub sometimes drops the first sound. |
| `/mcp` shows the server failed | Run `node src/server.js` in a terminal. It should print `MCP server ready on stdio` to stderr. Press Ctrl+C to quit. |
| Need more detail | `.mcp.json` sets `DEBUG=poweredup`. Logs appear in Claude Code's MCP logs (`claude --debug`). For scripts, run `$env:DEBUG="poweredup*"; npm run smoke`. |
| Debug the MCP server by hand | `npm run inspector` opens the MCP Inspector in a browser. |

## Project layout

```
.mcp.json                  MCP server registration for Claude Code
.claude/settings.json      approves the server + allows its tools
.claude/commands/          /train-connect /horn /train-start /train-stop /train-status /train-disconnect
src/server.js              MCP stdio server (tools)
src/train.js               train controller on top of node-poweredup
scripts/check-ble.js       is Bluetooth LE usable from Node?
scripts/smoke.js           hardware test without Claude
```
