#!/usr/bin/env node
// Claude Code status line: shows the DUPLO train connection state.
// Reads the state file written by the MCP server (src/train.js). It never
// touches Bluetooth, so it is fast and safe to run on every refresh.
// Claude Code passes session JSON on stdin; we use it for the model name.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_FILE =
  process.env.DUPLO_STATE_FILE || path.join(os.tmpdir(), "duplo-train-status.json");

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    const done = () => resolve(data);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", done);
    process.stdin.on("error", done);
    setTimeout(done, 300); // never block the status line
  });
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function formatTrain(state) {
  if (!state) return "🚂 train: server not started";
  if (!alive(state.pid) || state.phase === "offline") return "🚂 train: server offline";
  switch (state.phase) {
    case "scanning": return "🚂 scanning… press the green button";
    case "reconnecting": return "🚂 link lost, reconnecting…";
    case "connected": {
      if (!state.connected) break;
      const battery = state.batteryLevel != null ? ` · 🔋${state.batteryLevel}%` : "";
      const p = Number(state.power) || 0;
      const motion = p === 0 ? "stopped" : `${p > 0 ? "▶" : "◀"} ${Math.abs(p)}%`;
      return `🚂 connected${battery} · ${motion}`;
    }
    case "error":
      return /No DUPLO train found/.test(state.lastError ?? "")
        ? "🚂 not found, press green button + /train-connect"
        : "🚂 connect failed, retry /train-connect";
  }
  return state.lastError
    ? "🚂 disconnected, press green button + /train-connect"
    : "🚂 not connected (/train-connect)";
}

const input = await readStdin();
let model = "";
try { model = JSON.parse(input)?.model?.display_name ?? ""; } catch { /* ignore */ }

let state = null;
try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* no file yet */ }

process.stdout.write([model, formatTrain(state)].filter(Boolean).join(" | ") + "\n");
process.exit(0);
