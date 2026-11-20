---
description: Run unit tests and show the result on the train light
argument-hint: "[test command, default: npm test]"
allowed-tools: Bash(npm test:*), mcp__duplo-train__set_light, mcp__duplo-train__horn, mcp__duplo-train__play_sound
---
Show the unit test result on the DUPLO train. Train calls are best effort: if one fails, keep going and report the test result anyway.

1. Set the train light to YELLOW (tests running).
2. Run the test command: `$ARGUMENTS` if given, otherwise `npm test`.
3. If all tests pass: set the light GREEN and play STATION_DEPARTURE.
   If any test fails: set the light RED, play BRAKE, and list the failing tests, one line each.
4. Reply with one short summary line (passed/failed counts).
