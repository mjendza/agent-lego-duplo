// LEGO DUPLO train controller built on node-poweredup.
// Holds a single connection to one DUPLO Train Base (hub) and exposes
// high-level actions: connect, horn, sounds, start, stop, light, status.
//
// IMPORTANT: this module never writes to stdout (stdout is the MCP wire).

const log = (...args) => console.error("[duplo-train]", ...args);

export const SOUNDS = ["HORN", "BRAKE", "STATION_DEPARTURE", "WATER_REFILL", "STEAM"];
export const COLORS = [
  "BLACK", "PINK", "PURPLE", "BLUE", "LIGHT_BLUE", "CYAN",
  "GREEN", "YELLOW", "ORANGE", "RED", "WHITE", "NONE",
];

const CONNECT_HINT =
  "Press the green button on top of the DUPLO train (its light should blink), " +
  "make sure Windows Bluetooth is ON, the train is NOT paired in Windows Settings, " +
  "and it is not connected to the LEGO DUPLO app on a phone/tablet.";

let lib = null;        // lazily imported node-poweredup module
let poweredUP = null;  // PoweredUP scanner instance
let hub = null;        // connected DuploTrainBase
let devices = {};      // { motor, speaker, led }
let currentPower = 0;
let connecting = null; // in-flight connect promise (dedupe concurrent calls)

async function loadLib() {
  if (!lib) {
    // Imported lazily: importing node-poweredup initialises the Bluetooth stack,
    // so we only do it when the user actually wants to talk to the train.
    lib = await import("node-poweredup");
  }
  return lib;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isConnected() {
  return Boolean(hub && hub.connected !== false && devices.motor);
}

export async function connect({ timeoutMs = 30000, name } = {}) {
  if (isConnected()) return status();
  if (connecting) return connecting;

  connecting = (async () => {
    const { PoweredUP, Consts } = await loadLib();
    if (!poweredUP) poweredUP = new PoweredUP();

    log(`Scanning for a DUPLO train${name ? ` named "${name}"` : ""} (timeout ${timeoutMs} ms)...`);

    const found = await new Promise((resolve, reject) => {
      const onDiscover = (h) => {
        log(`Discovered hub "${h.name}" type=${h.type} uuid=${h.uuid}`);
        if (h.type !== Consts.HubType.DUPLO_TRAIN_BASE) return;
        if (name && h.name !== name) return;
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
    await found.connect();

    found.on("disconnect", () => {
      log("Train disconnected.");
      if (hub === found) { hub = null; devices = {}; currentPower = 0; }
    });

    const withTimeout = (p, what) => Promise.race([
      p,
      sleep(10000).then(() => { throw new Error(`Timed out waiting for train ${what}`); }),
    ]);

    const motor = await withTimeout(found.waitForDeviceAtPort("MOTOR"), "motor");
    const speaker = await withTimeout(
      found.waitForDeviceByType(Consts.DeviceType.DUPLO_TRAIN_BASE_SPEAKER), "speaker");
    const led = await withTimeout(found.waitForDeviceByType(Consts.DeviceType.HUB_LED), "LED")
      .catch((e) => { log(e.message); return null; });

    // Give the hub a moment after attaching devices; the very first command
    // right after connect is otherwise sometimes dropped.
    await sleep(500);

    hub = found;
    devices = { motor, speaker, led };
    currentPower = 0;
    log(`Connected to "${hub.name}" (battery ${hub.batteryLevel}%).`);
    return status();
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

async function ensureConnected() {
  if (!isConnected()) await connect();
}

export async function disconnect() {
  if (!hub) return { connected: false, message: "Train was not connected." };
  const h = hub;
  try { await devices.motor?.setPower(0); } catch { /* ignore */ }
  try { await h.disconnect(); } catch (e) { log("disconnect error:", e.message); }
  hub = null; devices = {}; currentPower = 0;
  return { connected: false, message: "Disconnected from the train." };
}

export async function playSound(soundName = "HORN") {
  await ensureConnected();
  const { Consts } = await loadLib();
  const key = String(soundName).toUpperCase();
  const sound = Consts.DuploTrainBaseSound[key];
  if (sound === undefined) throw new Error(`Unknown sound "${soundName}". Use one of: ${SOUNDS.join(", ")}`);
  await devices.speaker.playSound(sound);
  return { played: key };
}

export const horn = () => playSound("HORN");

/**
 * Start (or change speed of) the train.
 * @param {number} speed 0..100 (percent power)
 * @param {"forward"|"backward"} direction
 */
export async function start(speed = 50, direction = "forward") {
  await ensureConnected();
  const s = Math.max(0, Math.min(100, Math.round(Number(speed))));
  const power = direction === "backward" ? -s : s;
  await devices.motor.setPower(power);
  currentPower = power;
  return { moving: power !== 0, power, direction: power === 0 ? "stopped" : direction };
}

export async function stop({ brake = true } = {}) {
  if (!isConnected()) return { moving: false, message: "Train is not connected (nothing to stop)." };
  if (brake) await devices.motor.brake();
  else await devices.motor.setPower(0);
  currentPower = 0;
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
  await ensureConnected();
  if (!devices.led) throw new Error("Train LED not available.");
  const { Consts } = await loadLib();
  const key = String(colorName).toUpperCase();
  const color = Consts.Color[key];
  if (color === undefined) throw new Error(`Unknown color "${colorName}". Use one of: ${COLORS.join(", ")}`);
  await devices.led.setColor(color);
  return { light: key };
}

export function status() {
  if (!isConnected()) return { connected: false };
  return {
    connected: true,
    name: hub.name,
    uuid: hub.uuid,
    batteryLevel: hub.batteryLevel,
    power: currentPower,
    moving: currentPower !== 0,
  };
}
