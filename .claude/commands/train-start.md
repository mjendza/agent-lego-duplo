---
description: Start the DUPLO train (optional speed 0-100 and direction)
argument-hint: "[speed 0-100] [forward|backward]"
allowed-tools: mcp__duplo-train__start
---
Start the LEGO DUPLO train using the `mcp__duplo-train__start` tool.

Arguments from the user: "$ARGUMENTS"
- A number is the speed in percent (0-100). Default 50.
- "backward"/"back"/"reverse" means direction "backward"; otherwise "forward".
- Words like "slow" ≈ 30, "fast" ≈ 80, "full" ≈ 100.

Reply with one short line saying speed and direction.
