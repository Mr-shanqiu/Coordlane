# Codex desktop live acceptance — 2026-08-09

This acceptance used two synthetic, projectless, read-only Crew tasks. Stable
task IDs were used at runtime but are intentionally not stored in this public
artifact. No business repository, network service, secret, external system, or
real user data was accessed.

## Results

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Create two tasks asynchronously | Pass | Both returned distinct stable task IDs and the same current host ID |
| Initial assignment identity | Pass | Each newest user message contained its exact assignment ID |
| Target acknowledgement | Pass | Each first assistant update echoed the assignment ID, bounded scope, and first action |
| Active status is not ACK | Pass | ACK was recorded only after task content readback, not from `active` |
| Multi-target wait semantics | Pass | One wait woke for the first completed Crew and returned only that target |
| Per-task cursor full sweep | Pass | Independent zero-time snapshots discovered the other completion and suppressed the consumed one |
| Unchanged incremental scan | Pass | Both current cursors returned `changed=false` without repeated final text |
| Directed follow-up delivery | Pass | A one-shot task message returned delivery evidence; readback separately proved ACK |
| Structured terminal identity | Pass | Finals retained assignment, attempt, ownership epoch, status, revision, no-commit reason, and side-effect statement |
| Quiet raw-report handling | Pass | Full reports were read in the coordinator background; this artifact stores only conclusions |
| No write or side effect | Pass | Both projectless directories contained no files; Coordlane Git state remained unchanged |
| Archive and re-open lifecycle | Pass | Both tasks archived; one was reopened for directed-message testing and archived again |
| Executable Pre-final incident gate | Pass locally | Four-completion and scan-unavailable regressions pass in the reference state store |
| Codex project worktree creation | Not run | Saved Codex project registration still referenced the pre-rename directory, which no longer exists |
| Cryptographic durable report before final | Not run | Live finals used explicitly labeled placeholder digests; no shared report artifact was written |
| Post-final completion observer | Unavailable/unverified | Safe-point per-task cursor scans remain the completeness mechanism |

## Interpretation

The current adapter is confirmed as Level 2 for projectless Codex tasks:
stable identity, create, directed delivery, content-bound ACK, first-change
wait, independent cursor sweep, completed task record, and archive are working.
This does not upgrade the adapter to Level 1 because no completion observer or
cryptographically durable pre-final report event was verified.

Before worktree compatibility is claimed, update the Codex saved-project path
through the app and repeat this synthetic suite from a disposable branch. That
path correction is user/app configuration, not a repository code change.
