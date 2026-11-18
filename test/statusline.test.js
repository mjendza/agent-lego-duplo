// The status line script only reads the state file; no MCP server or Bluetooth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(os.tmpdir(), "duplo-sl-"));

function render(state, stdin = JSON.stringify({ model: { display_name: "Opus" } })) {
  const file = path.join(dir, `${Math.random()}.json`);
  if (state) writeFileSync(file, JSON.stringify(state));
  return execFileSync(process.execPath, [path.join(root, "scripts", "statusline.js")], {
    input: stdin, env: { ...process.env, DUPLO_STATE_FILE: file }, encoding: "utf8",
  }).trim();
}

test("no state file", () => {
  assert.equal(render(null), "Opus | 🚂 train: server not started");
});

test("connected and moving", () => {
  const out = render({ pid: process.pid, phase: "connected", connected: true, batteryLevel: 87, power: -40 });
  assert.equal(out, "Opus | 🚂 connected · 🔋87% · ◀ 40%");
});

test("stale file from a dead server is reported offline", () => {
  const out = render({ pid: 999999, phase: "connected", connected: true, power: 0 });
  assert.match(out, /server offline/);
});

test("reconnecting and lost states", () => {
  assert.match(render({ pid: process.pid, phase: "reconnecting" }), /reconnecting/);
  assert.match(render({ pid: process.pid, phase: "disconnected", lastError: "x" }), /press green button/);
  assert.match(render({ pid: process.pid, phase: "disconnected" }), /not connected/);
});

test("works without stdin JSON", () => {
  assert.equal(render(null, ""), "🚂 train: server not started");
});
