---
description: Watch the CI pipeline for the current branch/PR and show it on the train
allowed-tools: Bash(git branch:*), Bash(git rev-parse:*), Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh run list:*), Bash(gh run watch:*), Bash(gh run view:*), mcp__duplo-train__set_light, mcp__duplo-train__horn, mcp__duplo-train__play_sound
---
Show the GitHub Actions result for the current branch on the DUPLO train. Train calls are best effort: if one fails, keep going and report the pipeline result anyway.

1. Get the branch with `git branch --show-current` and the commit with `git rev-parse HEAD`.
2. Set the train light to YELLOW (pipeline running).
3. If the branch has an open PR (`gh pr view --json number,url`), run `gh pr checks --watch --fail-fast`.
   Otherwise find the run for this commit with `gh run list --branch <branch> --commit <sha> --limit 1 --json databaseId,status`
   (if there is none yet, wait 10 s and retry, up to 3 times), then run `gh run watch <databaseId> --exit-status`.
4. Success: set the light GREEN and blow the horn twice.
   Failure: set the light RED, play BRAKE, and list the failed jobs (`gh pr checks` or `gh run view <databaseId>`).
5. Reply with one short summary line and the PR or run URL.
