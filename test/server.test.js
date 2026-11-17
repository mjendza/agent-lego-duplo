// Hardware-free tests: start the MCP server over stdio and exercise it with the
// official MCP client. No Bluetooth is touched (node-poweredup is imported
// lazily and none of these calls need a train).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let client;

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { res, data, text };
};

before(async () => {
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "src", "server.js")],
    cwd: root,
    stderr: "pipe",
  }));
});

after(async () => { await client?.close(); });

test("server reports its name", () => {
  assert.equal(client.getServerVersion().name, "duplo-train");
});

test("lists all train tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "connect", "disconnect", "drive", "horn", "play_sound", "set_light", "start", "status", "stop",
  ]);
});

test("start schema limits speed to 0-100 and direction enum", async () => {
  const { tools } = await client.listTools();
  const start = tools.find((t) => t.name === "start");
  assert.equal(start.inputSchema.properties.speed.minimum, 0);
  assert.equal(start.inputSchema.properties.speed.maximum, 100);
  assert.deepEqual(start.inputSchema.properties.direction.enum, ["forward", "backward"]);
});

test("play_sound and set_light expose the library enums", async () => {
  const { tools } = await client.listTools();
  const sound = tools.find((t) => t.name === "play_sound").inputSchema.properties.sound.enum;
  const color = tools.find((t) => t.name === "set_light").inputSchema.properties.color.enum;
  assert.deepEqual(sound, ["HORN", "BRAKE", "STATION_DEPARTURE", "WATER_REFILL", "STEAM"]);
  assert.ok(color.includes("RED") && color.includes("NONE"));
});

test("status is disconnected at startup", async () => {
  const { data } = await call("status");
  assert.deepEqual(data, { connected: false });
});

test("stop without a train is a harmless no-op", async () => {
  const { res, data } = await call("stop");
  assert.notEqual(res.isError, true);
  assert.equal(data.moving, false);
});

test("disconnect without a train is a harmless no-op", async () => {
  const { res, data } = await call("disconnect");
  assert.notEqual(res.isError, true);
  assert.equal(data.connected, false);
});

test("horn with onlyIfConnected does not scan when disconnected (hook path)", async () => {
  const t0 = Date.now();
  const { res, data } = await call("horn", { onlyIfConnected: true });
  assert.notEqual(res.isError, true);
  assert.deepEqual(data, { played: false, reason: "train not connected" });
  assert.ok(Date.now() - t0 < 2000, "must return immediately");
});

test("invalid speed is rejected", async () => {
  let failed = false;
  try {
    const { res } = await call("start", { speed: 150 });
    failed = res.isError === true;
  } catch {
    failed = true; // older SDKs throw on validation errors
  }
  assert.ok(failed, "speed 150 should be rejected");
});

test("invalid sound is rejected", async () => {
  let failed = false;
  try {
    const { res } = await call("play_sound", { sound: "MOO" });
    failed = res.isError === true;
  } catch {
    failed = true;
  }
  assert.ok(failed, "unknown sound should be rejected");
});
