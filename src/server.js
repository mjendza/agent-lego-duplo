#!/usr/bin/env node
// MCP (stdio) server exposing LEGO DUPLO train controls to Claude Code.
//
// stdout carries JSON-RPC, so redirect every console print to stderr
// BEFORE anything else can log.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = await import("zod");
const train = await import("./train.js");

const server = new McpServer({ name: "duplo-train", version: "1.0.0" });

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ content: [{ type: "text", text: `Error: ${err?.message ?? err}` }], isError: true });
const wrap = (fn) => async (args) => { try { return ok(await fn(args ?? {})); } catch (e) { return fail(e); } };

server.registerTool("connect", {
  title: "Connect to DUPLO train",
  description:
    "Scan over Bluetooth LE and connect to a LEGO DUPLO train. Ask the user to press the green " +
    "button on the train first. Other tools auto-connect, so this is optional.",
  inputSchema: {
    timeoutSeconds: z.number().int().min(5).max(120).default(30).describe("How long to scan"),
    name: z.string().optional().describe("Only connect to a hub with this Bluetooth name"),
  },
}, wrap(({ timeoutSeconds = 30, name }) => train.connect({ timeoutMs: timeoutSeconds * 1000, name })));

server.registerTool("disconnect", {
  title: "Disconnect train",
  description: "Stop the motor and disconnect from the DUPLO train (the train then powers down).",
  inputSchema: {},
}, wrap(() => train.disconnect()));

server.registerTool("status", {
  title: "Train status",
  description: "Connection state, hub name, battery level and current motor power.",
  inputSchema: {},
}, wrap(async () => train.status()));

server.registerTool("horn", {
  title: "Sound the horn",
  description: "Play the train horn.",
  inputSchema: {
    onlyIfConnected: z.boolean().default(false)
      .describe("If true, do nothing when the train is not connected (no Bluetooth scan). Used by hooks."),
  },
}, wrap(({ onlyIfConnected = false }) => {
  if (onlyIfConnected && !train.isConnected()) return { played: false, reason: "train not connected" };
  // Hook path: never reconnect/retry, so Claude never waits on Bluetooth.
  return train.horn({ retry: !onlyIfConnected });
}));

server.registerTool("play_sound", {
  title: "Play train sound",
  description: "Play one of the built-in DUPLO train sounds.",
  inputSchema: { sound: z.enum(train.SOUNDS).describe("Sound to play") },
}, wrap(({ sound }) => train.playSound(sound)));

server.registerTool("start", {
  title: "Start / set speed",
  description:
    "Start the train or change its speed. Speed is percent motor power 0-100 " +
    "(below ~20 the train may not move; 0 stops). Keeps running until stop is called.",
  inputSchema: {
    speed: z.number().min(0).max(100).default(50).describe("Motor power in percent"),
    direction: z.enum(["forward", "backward"]).default("forward"),
  },
}, wrap(({ speed = 50, direction = "forward" }) => train.start(speed, direction)));

server.registerTool("drive", {
  title: "Drive for N seconds",
  description: "Drive at a speed for a number of seconds (max 60), then brake.",
  inputSchema: {
    speed: z.number().min(0).max(100).default(50),
    direction: z.enum(["forward", "backward"]).default("forward"),
    seconds: z.number().min(0.5).max(60).describe("Duration in seconds"),
  },
}, wrap(({ speed = 50, direction = "forward", seconds }) => train.drive(speed, direction, seconds)));

server.registerTool("stop", {
  title: "Stop the train",
  description: "Stop the train. brake=true (default) brakes immediately, false lets it coast.",
  inputSchema: { brake: z.boolean().default(true) },
}, wrap(({ brake = true }) => train.stop({ brake })));

server.registerTool("set_light", {
  title: "Set headlight color",
  description: "Set the train's light color (NONE turns it off).",
  inputSchema: { color: z.enum(train.COLORS) },
}, wrap(({ color }) => train.setLight(color)));

// Make sure the train does not keep running when Claude Code exits.
let shuttingDown = false;
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[duplo-train] shutting down (${reason})`);
  try { await Promise.race([train.disconnect(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* ignore */ }
  train.publishState({ phase: "offline", connected: false });
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.stdin.on("end", () => shutdown("stdin closed"));
process.stdin.on("close", () => shutdown("stdin closed"));

await server.connect(new StdioServerTransport());
train.publishState(); // status line: server up, train not connected yet
console.error("[duplo-train] MCP server ready on stdio");

// Optional: connect to the train as soon as the server starts (i.e. when Claude
// Code starts). DUPLO_AUTOCONNECT = "1"/"true" (scan 60 s) or a number of seconds.
// Runs in the background so it never blocks MCP startup; progress shows in the status line.
const auto = String(process.env.DUPLO_AUTOCONNECT ?? "").trim().toLowerCase();
if (auto && !["0", "false", "no", "off"].includes(auto)) {
  const secs = Number(auto);
  const timeoutSeconds = Number.isFinite(secs) && secs > 0 ? Math.min(120, Math.max(5, secs)) : 60;
  console.error(`[duplo-train] auto-connect: scanning up to ${timeoutSeconds} s`);
  train.connect({ timeoutMs: timeoutSeconds * 1000 })
    .then((s) => console.error(`[duplo-train] auto-connect ok (battery ${s.batteryLevel}%)`))
    .catch((e) => console.error(`[duplo-train] auto-connect failed: ${e.message}`));
}
