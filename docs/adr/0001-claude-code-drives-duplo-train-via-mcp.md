# ADR 0001: Claude Code drives a LEGO DUPLO train through a local MCP server

- **Status:** Accepted
- **Date:** 2026-11-19
- **Diagram:** [`docs/architecture.excalidraw`](../architecture.excalidraw) (open at <https://excalidraw.com> or with the VS Code Excalidraw extension)

![Architecture](../architecture.svg)

## Summary (blog intro)

An AI coding agent spends its day in a terminal. It reads code and runs commands, and when it's done it waits quietly for you to notice. So I gave it a train.

This project connects Claude Code to a LEGO DUPLO train over Bluetooth. You can ask *"drive forward at 40 for five seconds, then blow the horn"* and a toy locomotive rolls across the desk. Better still, the train **honks when Claude finishes or needs your permission**, and the Claude Code **status line** shows the train's state live: `🚂 connected · 🔋85% · ▶ 40%`.

The plumbing is small and fits the usual extension points: one MCP server, two hooks, a status line script and a few slash commands. That makes it a compact, real-hardware example of how the **Model Context Protocol** connects an agent to the physical world. This ADR records how it's built and why.

## Context

- The DUPLO Train Base (sets 10874, 10875, 10427, 10428, …) is a LEGO Powered Up hub. It exposes a motor, a speaker with built-in sounds, an RGB light and a battery level over **Bluetooth Low Energy**. You don't pair it in the OS. A client scans, finds the advertising hub and connects. The hub accepts **one** connection at a time and powers off after a few idle minutes.
- [`node-poweredup`](https://github.com/nathankellenicky/node-poweredup) (on top of `@stoprocent/noble`) already implements the protocol in Node.js, with a prebuilt Windows binary.
- Claude Code can be extended in several ways:
  - **MCP servers** give the model tools.
  - **Hooks** run on agent events (`Stop`, `Notification`, …). They can be shell commands or `mcp_tool` calls.
  - A **status line** command runs periodically and prints one line.
  - **Slash commands** are prompt templates.
- Requirements:
  1. Natural-language and slash-command control from Claude Code.
  2. An audible signal when Claude needs the user.
  3. Always-visible connection and battery state.
  4. Bluetooth trouble must never hang or slow down the agent.
  5. Zero setup beyond `npm install` and `claude` from the repo root.

## Decision

### 1. One stdio MCP server owns the Bluetooth connection

`src/server.js` is an MCP server (`@modelcontextprotocol/sdk`, stdio transport). It's registered in the project's `.mcp.json`, so Claude Code spawns it when it starts, and it exposes 9 tools:
- `connect`, `disconnect` and `status`
- `horn`, `play_sound`, `start`, `drive`, `stop` and `set_light`

The process lives as long as the Claude Code session. That makes it the **single owner** of the BLE link, which matters because the hub allows only one connection. Every other part of the system (hooks, slash commands, the model) talks to the train through this process.

- **stdout is the JSON-RPC channel.** `console.log/info/debug` are redirected to stderr before anything else loads, and the code rule is "never write to stdout in `src/`".
- **Bluetooth loads lazily.** Importing `node-poweredup` initialises the BLE stack, so `src/train.js` imports it on first use. The server always starts, and CI tests it on machines without Bluetooth.
- **Shutdown is safe.** On SIGINT, SIGTERM or stdin close, the server stops the motor, disconnects and marks its state `offline`.
- **Auto-connect is optional.** `DUPLO_AUTOCONNECT=60` in `.mcp.json` starts a background scan when the server starts, so it never blocks MCP startup.

### 2. A controller module with timeouts, reconnect and one retry

`src/train.js` hides the hub behind high-level actions. Every BLE command goes through `run()`:

- **Timeouts.** Each command has a 5 s timeout. Device attach waits up to 10 s, and a re-scan up to 20 s.
- **Retry once.** On failure, `run()` drops the stale link, re-scans for the **same train** (it remembers the UUID) and retries the command once. Usage errors (for example "no LED") are not retried.
- **Background reconnect.** An unexpected disconnect triggers one background re-scan.
- **No half-open links.** If connecting fails halfway, the hub is released. Otherwise the train would stay connected and be invisible to the next scan.
- **No dedupe needed by callers.** Concurrent `connect` calls share one in-flight promise.
- **Fast paths.** `stop` and the hook horn never reconnect. A hub that loses its link stops its motor anyway.

### 3. Hooks call the MCP tool, not a script

The `Stop` and `Notification` hooks in `.claude/settings.json` use the **`mcp_tool`** hook type to call `horn` with `onlyIfConnected: true`.

A shell-command hook would start a new process. That process can't use the existing BLE connection, and it would compete with the server for the hub. Going through the MCP server reuses the live link instead. When the train isn't connected, the call returns immediately and doesn't scan, so the agent never waits on Bluetooth.

### 4. The status line reads a state file and never touches Bluetooth

`src/train.js` mirrors its state to `%TEMP%/duplo-train-status.json`: phase, pid, name, uuid, battery, power and last error. It writes after every phase change, power change or battery event. The write is atomic: it writes a temp file and then renames it. `DUPLO_STATE_FILE` overrides the path, and the tests use that.

`scripts/statusline.js`, configured with `refreshInterval: 5`, only reads that file. It checks whether the server's pid is still alive, so a crashed server shows `server offline` and not a stale `connected`. It never blocks for more than 300 ms on stdin. It shows these states:
- `scanning… press the green button`
- `connected`, with battery and motion
- `link lost, reconnecting…`
- not found or disconnected, with a hint to run `/train-connect`

### 5. Slash commands are thin prompts

`.claude/commands/train-*.md` and `horn.md` tell Claude which MCP tool to call. They don't contain any logic. The project settings pre-approve the `duplo-train` server and its tools, so you don't get a permission prompt on every horn.

## Alternatives considered

| Option | Why not |
|---|---|
| CLI script per command, called with Bash | Each call would scan and connect from scratch, taking seconds and needing a button press. It also can't coexist with a held connection, because the hub allows only one client. |
| Hooks as shell commands | Same single-connection problem. A hook would also block the agent while it scans. |
| Status line queries the server or BLE directly | The status line runs every 5 s in a separate process. Bluetooth access there would be slow and would conflict with the server. A file is the simplest IPC that can't hang. |
| HTTP/SSE MCP server run as a separate daemon | Works, but needs a separate start step and lifecycle. Stdio ties the server to the Claude Code session for free, including stopping the train on exit. |
| Pair the train in the OS | Powered Up hubs aren't meant to be OS-paired. Paired trains often fail to connect. |

## Consequences

**Positive**
- Plug-and-play: clone, `npm install`, `claude`. All wiring is checked into the project (`.mcp.json`, `.claude/settings.json`, `.claude/commands/`).
- Bluetooth failures stay contained. A dead link can't hang the model, the hooks or the status line.
- The server runs and is tested without hardware. CI runs on Ubuntu and Windows with Node 20 and 24. `npm run smoke` covers the hardware path by hand.
- The pattern (one long-lived MCP server owns a device, hooks reuse it, a state file feeds the UI) carries over to other hardware.

**Negative / trade-offs**
- Only one train per session. Two Claude Code sessions share one state file, and the most recent writer wins.
- The project `statusLine` replaces your personal status line while you work in this repo.
- The `statusLine` command path is relative, so `claude` must be started from the repo root.
- Auto-reconnect can't wake a train that has powered off. You have to press the green button.
- The hub sometimes drops the first command after connecting. A 500 ms settle delay helps but doesn't fully fix it.
