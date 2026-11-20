// Hardware smoke test without Claude: connect -> horn -> drive 2 s -> stop -> disconnect.
// Usage: npm run smoke            (full test)
//        npm run scan             (only find + connect + report status)
// Set DEBUG=poweredup* for verbose library logs.
import * as train from "../src/train.js";

const scanOnly = process.argv.includes("--scan-only");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log("Looking for the DUPLO train... press the green button on the train now.");
  console.log("Connected:", await train.connect({ timeoutMs: 45000 }));

  if (!scanOnly) {
    console.log("Horn:", await train.horn());
    await sleep(1500);
    console.log("Light:", await train.setLight("GREEN"));
    console.log("Drive:", await train.drive(50, "forward", 2));
    console.log("Sound:", await train.playSound("BRAKE"));
    await sleep(1500);
  }

  console.log("Status:", train.status());
  await train.disconnect();
  console.log("Done.");
  process.exit(0);
} catch (err) {
  console.error("FAILED:", err.message);
  try { await train.disconnect(); } catch { /* ignore */ }
  process.exit(1);
}
