# Implementation self-audit

Last audited: 2026-08-09

## Runnable now

- Seven JSON Schemas and valid/invalid validation checks.
- A Node.js filesystem reference implementing registry, assignments,
  acknowledgement, ownership, reports, events, cursors, full sweeps,
  validation, branch-policy checks, release, and recovery.
- Fifteen executable failure-scenario tests covering the field failures in the
  protocol upgrade.
- Executable `beginTurn`, `preFinalGate`, and `assertFinalizable` guards,
  including the four-simultaneous-completion incident and scan-unavailable
  regression.
- Dynamic heartbeat state, lightweight probe, durable no-number completion
  recovery, honest `next_turn_only` fallback, and automatic stop regression.
- Prompt templates and a portable Skill with safe-point coordination rules.

## Codex live acceptance

- Current Codex desktop exposes stable task IDs, task list/read/send/wait,
  per-task cursors, `timeoutMs=0` snapshots, archive, and worktree-aware task
  creation. The current task inventory was read without opening unrelated task
  contents.
- Two authorized synthetic projectless tasks passed stable identity, create,
  assignment readback, ACK, directed delivery, first-change wait, independent
  cursor drain, unchanged suppression, structured final, and archive checks.
- Codex worktree creation remains untested because the saved project entry
  still points to the pre-rename directory, which no longer exists.
- Live reports used explicit placeholder digests; cryptographic durable-report
  persistence before final remains unverified.
- The current host does not establish a completion observer that runs after a
  worker final answer; safe-point full sweeps remain authoritative during a
  turn. An opt-in heartbeat provides sleeping-period liveness; a strict SLA
  requires a broker with a verified scheduler bound.
- A live heartbeat discovered a silent post-final completion without user
  input, but detection took 110.67 seconds and failed the nominal 60-second
  target. Current Codex heartbeat is best-effort eventual liveness, not a
  verified latency SLA.

## Deferred, not supported

- Claude Code, CodeBuddy, WorkBuddy, and Generic directories are research notes
  excluded from current tests and compatibility claims.
- No cross-process locking, network transport, UI, daemon, authentication,
  remote report store, or completion observer is shipped.
- No automatic Git cherry-pick/merge, migration, deployment, release, runtime
  switch, or external call is performed.

## Evidence boundary

Passing tests proves repository rules, Codex adapter-contract shape, and
simulations. The projectless live acceptance evidence is recorded in
[`testing/codex-live-acceptance-2026-08-09.md`](testing/codex-live-acceptance-2026-08-09.md).
Before a Codex release, repeat it with a corrected saved-project path and a
disposable worktree, then add durable digest verification.

Sleeping-period evidence is recorded in
[`testing/codex-sleeping-controller-acceptance-2026-08-09.md`](testing/codex-sleeping-controller-acceptance-2026-08-09.md).
