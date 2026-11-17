---
description: Connect to the LEGO DUPLO train over Bluetooth
argument-hint: "[timeout-seconds]"
allowed-tools: mcp__duplo-train__connect, mcp__duplo-train__status
---
Connect to the LEGO DUPLO train.

1. First tell the user: "Press the green button on top of the train now - its light should start blinking."
2. Call the `mcp__duplo-train__connect` tool (use `timeoutSeconds` = $ARGUMENTS if a number was given, otherwise 30).
3. Report the hub name and battery level. If it failed, show the error and suggest: Bluetooth on, train not paired in Windows Settings, LEGO DUPLO app closed on phones/tablets, fresh batteries, then retry.
