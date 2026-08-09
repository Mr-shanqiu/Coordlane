# Codex sleeping-controller acceptance — 2026-08-09

This live test used one synthetic, projectless, read-only Crew. Runtime task IDs
are intentionally omitted from this public artifact.

## Procedure

1. Register a Crew Assignment and verify identity-bound acknowledgement.
2. Require two bounded waits so the Captain can emit final first.
3. Forbid numeric wake messages and all cross-task messaging.
4. Arm a temporary one-minute Codex heartbeat attached to the Captain task.
5. On each heartbeat, run one zero-time cursor snapshot only.
6. Read the terminal turn only after the snapshot reports completion.
7. Archive the Crew and pause the heartbeat after ingest.

## Result

| Check | Result |
| --- | --- |
| Captain final occurred before Crew completion | Pass |
| Crew sent no numeric or directed wake | Pass |
| First heartbeat saw active state and advanced only its cursor | Pass |
| Later heartbeat discovered terminal state without user input | Pass |
| Assignment ID, attempt, status, revision, no-commit reason, files, and side effects verified | Pass |
| Raw report excluded from user-facing summary | Pass |
| Worker archive and heartbeat pause | Pass |
| Completion-to-detection latency | 110.67 seconds |
| Nominal 60-second discovery target | **Fail** |

The worker completed at `2026-08-09T15:38:59.000Z`; the heartbeat detected it
at `2026-08-09T15:40:49.670Z`. The mechanism proves sleeping-controller
eventual liveness, but the current Codex scheduler did not meet a strict
60-second SLA. A recurrence interval is not an SLA unless the host documents
and verifies a maximum scheduler delay.

## Accepted claim

Codex heartbeat can discover a silent post-final completion without waiting
for a user message. On the tested host it is best-effort and dynamically
bounded in lifetime, not bounded in detection latency. A strict SLA requires a
completion observer or event broker with a verified delivery bound.
