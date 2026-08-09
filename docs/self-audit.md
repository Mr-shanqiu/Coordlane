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
- A plugin manifest, bundled Skill, `Stop` terminal gate, `PostToolUse` receipt
  recorder, bounded degraded-delivery fallback, and Hook regression tests.
- Prompt templates and safe-point coordination rules.

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
- The plugin Hook implementation is locally executable but has not yet passed
  live Codex trust, `Stop`, and `PostToolUse(send_message_to_thread)` acceptance.
- The earlier heartbeat experiment took 110.67 seconds on a nominal one-minute
  recurrence. It is retained as historical evidence and removed from the
  current runtime.

## Deferred, not supported

- Claude Code, CodeBuddy, WorkBuddy, and Generic directories are research notes
  excluded from current tests and compatibility claims.
- No cross-process locking, network transport, UI, daemon, authentication, or
  remote report store is shipped.
- No automatic Git cherry-pick/merge, migration, deployment, release, runtime
  switch, or external call is performed.

## Evidence boundary

Passing tests proves repository rules, Codex adapter-contract shape, and
simulations. The projectless live acceptance evidence is recorded in
[`testing/codex-live-acceptance-2026-08-09.md`](testing/codex-live-acceptance-2026-08-09.md).
Before a Codex release, repeat it with a corrected saved-project path and a
disposable worktree, add durable digest verification, then run live Hook trust
and terminal-delivery acceptance.

The removed heartbeat experiment is recorded historically in
[`testing/codex-sleeping-controller-acceptance-2026-08-09.md`](testing/codex-sleeping-controller-acceptance-2026-08-09.md).
