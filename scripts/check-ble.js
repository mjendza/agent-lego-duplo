// Checks that the Bluetooth LE stack is usable from Node (no train needed).
// Usage: npm run check:ble
import noble from "@stoprocent/noble";

const timer = setTimeout(() => {
  console.log(`Bluetooth state: ${noble.state ?? "unknown"} (no 'poweredOn' within 10 s)`);
  console.log("-> Turn Bluetooth on in Windows Settings and make sure a BLE-capable adapter is present.");
  process.exit(1);
}, 10000);

const report = (state) => {
  console.log(`Bluetooth state: ${state}`);
  if (state === "poweredOn") {
    console.log("OK - Node can use the Bluetooth LE adapter.");
    clearTimeout(timer);
    process.exit(0);
  }
};

noble.on("stateChange", report);
if (noble.state === "poweredOn") report(noble.state);
