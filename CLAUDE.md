# CLAUDE.md

This repo controls a LEGO DUPLO train over Bluetooth LE via the `duplo-train` MCP server (`src/server.js`, built on node-poweredup).

## Driving the train
- Use the `mcp__duplo-train__*` tools: `connect`, `horn`, `play_sound`, `start`, `drive`, `stop`, `set_light`, `status`, `disconnect`.
- Before the first connect, tell the user to press the green button on the train (light blinks). Action tools auto-connect.
- Speed is percent power 0–100; below ~20 the train may not move. Prefer `drive` (timed) over `start` when the user gives a duration.
- Safety: if the user says stop/halt/"wait", call `stop` immediately.

## Code rules
- ESM (`"type": "module"`). Never write to stdout in `src/` — stdout is the MCP JSON-RPC channel; log with `console.error`.
- `node-poweredup` is imported lazily in `src/train.js` so the server starts without Bluetooth.
- Standalone scripts must end with `process.exit()` (noble keeps the event loop alive).
- Hardware test: `npm run smoke`. BLE check: `npm run check:ble`.
