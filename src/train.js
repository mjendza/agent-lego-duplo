// LEGO DUPLO train controller built on node-poweredup.
// Holds a single connection to one DUPLO Train Base (hub) and exposes
// high-level actions: connect, horn, sounds, start, stop, light, status.
//
// Reliability:
//  - every BLE command has a timeout, so a dead link never hangs the MCP call;
//  - a failed command drops the stale connection, re-scans for the same train
//    and retries the command once;
//  - an unexpected disconnect triggers one background re-scan (the hub goes
//    back to advertising when it loses the link, so it can be found again
//    unless it has powered off);
//  - the current state is mirrored to a small JSON file that the Claude Code
//    status line reads (see scripts/statusline.js).
//
// IMPORTANT: this module never writes to stdout (stdout is the MCP wire).

import { writeFileSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const log = (...args) => console.error("[duplo-train]", ...args);

export const SOUNDS = ["HORN", "BRAKE", "STATION_DEPARTURE", "WATER_REFILL", "STEAM"];
export const COLORS = [
  "BLACK", "PINK", "PURPLE", "BLUE", "LIGHT_BLUE", "CYAN",
  "GREEN", "YELLOW", "ORANGE", "RED", "WHITE", "NONE",
];

export const STATE_FILE =
  process.env.DUPLO_STATE_FILE || path.join(os.tmpdir(), "duplo-train-status.json");

const CONNECT_HINT =
  "Press the green button on top of the DUPLO train (its light should blink), " +
  "make sure Windows Bluetooth is ON, the train is NOT paired in Windows Settings, " +
  "and it is not connected to the LEGO DUPLO app on a phone/tablet.";

const COMMAND_TIMEOUT_MS = 5000;    // a single BLE write
const DEVICE_TIMEOUT_MS = 10000;    // waiting for motor/speaker/LED after connect
const RECONNECT_TIMEOUT_MS = 20000; // re-scan after a lost link

let lib = null;        // lazily imported node-poweredup module
let poweredUP = null;  // PoweredUP scanner instance
let hub = null;        // connected DuploTrainBase
let devices = {};      // { motor, speaker, led }
let currentPower = 0;
let connecting = null; // in-flight connect promise (dedupe concurrent calls)
let lastUuid = null;   // remembered so a reconnect finds the same train
let lastError = null;
let phase = "disconnected"; // disconnected | scanning | connected | reconnecting | error

async function loadLib() {
  if (!lib) {
    // Imported lazily: importing node-poweredup initialises the Bluetooth stack,
    // so we only do it when the user actually wants to talk to the train.
    lib = await import("node-poweredup");
  }
  return lib;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for train ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- state file

export function publishState(extra = {}) {
  const s = {
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    phase,
    connected: isConnected(),
    name: hub?.name ?? null,
    uuid: hub?.uuid ?? lastUuid,
    batteryLevel: hub?.batteryLevel ?? null,
    power: currentPower,
    lastError,
    ...extra,
  };
  try {
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, STATE_FILE);
  } catch (e) {
    log("could not write state file:", e.message);
  }
}

function setPhase(p, error = null) {
  phase = p;
  lastError = error;
  publishState();
}

/** Forget the current hub (link is dead or was closed). */
function dropConnection() {
  const h = hub;
  hub = null; devices = {}; currentPower = 0;
  if (h) { try { h.removeAllListeners("disconnect"); h.disconnect().catch(() => {}); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------- connection

export function isConnected() {
  return Boolean(hub && hub.connected && devices.motor);
}

export async function connect({ timeoutMs = 30000, name, uuid } = {}) {
  if (isConnected()) return status();
  if (connecting) return connecting;

  connecting = (async () => {
    setPhase(phase === "reconnecting" ? "reconnecting" : "scanning");
    const { PoweredUP, Consts } = await loadLib();
    if (!poweredUP) poweredUP = new PoweredUP();

    log(`Scanning for a DUPLO train${name ? ` named "${name}"` : ""}${uuid ? ` uuid=${uuid}` : ""} (timeout ${timeoutMs} ms)...`);

    const found = await new Promise((resolve, reject) => {
      const onDiscover = (h) => {
        log(`Discovered hub "${h.name}" type=${h.type} uuid=${h.uuid}`);
        if (h.type !== Consts.HubType.DUPLO_TRAIN_BASE) return;
        if (name && h.name !== name) return;
        if (uuid && h.uuid !== uuid) return;
        cleanup();
        resolve(h);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`No DUPLO train found within ${Math.round(timeoutMs / 1000)} s. ${CONNECT_HINT}`));
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        poweredUP.removeListener("discover", onDiscover);
        try { poweredUP.stop(); } catch { /* ignore */ }
      }
      poweredUP.on("discover", onDiscover);
      poweredUP.scan().catch((e) => { cleanup(); reject(e); });
    });

    log(`Connecting to "${found.name}"...`);
    try {
      await withTimeout(found.connect(), DEVICE_TIMEOUT_MS, "connection");
      const motor = await withTimeout(found.waitForDeviceAtPort("MOTOR"), DEVICE_TIMEOUT_MS, "motor");
      const speaker = await withTimeout(
        found.waitForDeviceByType(Consts.DeviceType.DUPLO_TRAIN_BASE_SPEAKER), DEVICE_TIMEOUT_MS, "speaker");
      const led = await withTimeout(
        found.waitForDeviceByType(Consts.DeviceType.HUB_LED), DEVICE_TIMEOUT_MS, "LED")
        .catch((e) => { log(e.message); return null; });

      // Give the hub a moment after attaching devices; the very first command
      // right after connect is otherwise sometimes dropped.
      await sleep(500);

      hub = found;
      devices = { motor, speaker, led };
      currentPower = 0;
      lastUuid = found.uuid;
    } catch (e) {
      // Half-open connection: the hub stops advertising while it is connected,
      // so release it or every later scan would fail until it powers off.
      try { await withTimeout(found.disconnect(), 3000, "disconnect"); } catch { /* ignore */ }
      throw e;
    }

    found.on("disconnect", () => {
      if (hub !== found) return; // we dropped it on purpose
      log("Train disconnected unexpectedly.");
      hub = null; devices = {}; currentPower = 0;
      backgroundReconnect();
    });
    found.on("batteryLevel", () => publishState());

    log(`Connected to "${hub.name ?? hub.uuid}" (battery ${hub.batteryLevel}%).`);
    setPhase("connected");
    return status();
  })();

  try {
    return await connecting;
  } catch (e) {
    setPhase("error", e.message);
    throw e;
  } finally {
    connecting = null;
  }
}

function backgroundReconnect() {
  if (!lastUuid) { setPhase("disconnected", "Lost connection to the train."); return; }
  phase = "reconnecting";
  connect({ timeoutMs: RECONNECT_TIMEOUT_MS, uuid: lastUuid })
    .then(() => log("Reconnected to the train."))
    .catch((e) => {
      log("Background reconnect failed:", e.message);
      setPhase("disconnected", "Lost connection and could not find the train again. " + CONNECT_HINT);
    });
}

/** An error that is not caused by the Bluetooth link (no reconnect/retry). */
class UsageError extends Error {}

/**
 * Run a BLE command on a connected train. On timeout/error the stale link is
 * dropped, the same train is re-scanned and the command is retried once.
 */
async function run(what, fn, { retry = true } = {}) {
  if (!isConnected()) await connect();
  try {
    return await withTimeout(Promise.resolve().then(fn), COMMAND_TIMEOUT_MS, what);
  } catch (e) {
    if (e instanceof UsageError) throw e; // not a link problem
    log(`${what} failed (${e.message})${retry ? ", reconnecting and retrying once" : ""}`);
    dropConnection();
    if (!retry) { setPhase("disconnected", e.message); throw e; }
    phase = "reconnecting";
    await connect({ uuid: lastUuid ?? undefined, timeoutMs: RECONNECT_TIMEOUT_MS });
    return withTimeout(Promise.resolve().then(fn), COMMAND_TIMEOUT_MS, what);
  }
}

export async function disconnect() {
  if (!hub) {
    lastUuid = null; // explicit disconnect: forget the train, no auto-reconnect
    setPhase("disconnected");
    return { connected: false, message: "Train was not connected." };
  }
  const h = hub;
  hub = null; // mark as intentional before the "disconnect" event fires
  try { await withTimeout(devices.motor?.setPower(0) ?? Promise.resolve(), 2000, "motor stop"); } catch { /* ignore */ }
  try { await withTimeout(h.disconnect(), 3000, "disconnect"); } catch (e) { log("disconnect error:", e.message); }
  devices = {}; currentPower = 0; lastUuid = null;
  setPhase("disconnected");
  return { connected: false, message: "Disconnected from the train." };
}

// ---------------------------------------------------------------- actions

export async function playSound(soundName = "HORN", opts = {}) {
  const { Consts } = await loadLib();
  const key = String(soundName).toUpperCase();
  const sound = Consts.DuploTrainBaseSound[key];
  if (sound === undefined) throw new Error(`Unknown sound "${soundName}". Use one of: ${SOUNDS.join(", ")}`);
  await run(`sound ${key}`, () => devices.speaker.playSound(sound), opts);
  return { played: key };
}

export const horn = (opts) => playSound("HORN", opts);

/**
 * Start (or change speed of) the train.
 * @param {number} speed 0..100 (percent power)
 * @param {"forward"|"backward"} direction
 */
export async function start(speed = 50, direction = "forward") {
  const s = Math.max(0, Math.min(100, Math.round(Number(speed))));
  const power = direction === "backward" ? -s : s;
  await run("motor", () => devices.motor.setPower(power));
  currentPower = power;
  publishState();
  return { moving: power !== 0, power, direction: power === 0 ? "stopped" : direction };
}

export async function stop({ brake = true } = {}) {
  if (!isConnected()) return { moving: false, message: "Train is not connected (nothing to stop)." };
  try {
    // No reconnect here: stopping must be fast, and a hub that lost its link stops its motor anyway.
    await run("stop", () => (brake ? devices.motor.brake() : devices.motor.setPower(0)), { retry: false });
  } catch (e) {
    return { moving: false, braked: false, message: `Lost connection while stopping (${e.message}); the train stops when the link drops.` };
  }
  currentPower = 0;
  publishState();
  return { moving: false, braked: brake };
}

/** Run for a fixed time, then stop. */
export async function drive(speed, direction, seconds) {
  const started = await start(speed, direction);
  await sleep(Math.max(0, Math.min(60, Number(seconds))) * 1000);
  await stop();
  return { ...started, ranSeconds: seconds, moving: false };
}

export async function setLight(colorName = "WHITE") {
  const { Consts } = await loadLib();
  const key = String(colorName).toUpperCase();
  const color = Consts.Color[key];
  if (color === undefined) throw new Error(`Unknown color "${colorName}". Use one of: ${COLORS.join(", ")}`);
  await run("light", () => {
    if (!devices.led) throw new UsageError("Train LED not available.");
    return devices.led.setColor(color);
  });
  return { light: key };
}

export function status() {
  if (!isConnected()) {
    const s = { connected: false };
    if (connecting) s.phase = phase;
    if (lastError) s.lastError = lastError;
    return s;
  }
  return {
    connected: true,
    name: hub.name,
    uuid: hub.uuid,
    batteryLevel: hub.batteryLevel,
    power: currentPower,
    moving: currentPower !== 0,
  };
}
