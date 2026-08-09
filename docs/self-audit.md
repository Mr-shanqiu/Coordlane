# Implementation self-audit

Last audited: 2026-08-09

## Runnable now

- Seven JSON Schemas and valid/invalid validation checks.
- A Node.js filesystem reference implementing registry, assignments,
  acknowledgement, ownership, reports, events, cursors, full sweeps,
  validation, branch-policy checks, release, and recovery.
- Fifteen executable failure-scenario tests covering the field failures in the
  protocol upgrade.
- Prompt templates and a portable Skill with safe-point coordination rules.

## Codex mapping with incomplete live acceptance

- Current Codex desktop exposes stable task IDs, task list/read/send/wait,
  per-task cursors, `timeoutMs=0` snapshots, archive, and worktree-aware task
  creation. The current task inventory was read without opening unrelated task
  contents.
- A live synthetic create/dispatch/ACK/completion test has not run because
  creating user-owned tasks requires explicit user authorization.
- The current host does not establish a completion observer that runs after a
  worker final answer; safe-point full sweeps remain authoritative.

## Deferred, not supported

- Claude Code, CodeBuddy, WorkBuddy, and Generic directories are research notes
  excluded from current tests and compatibility claims.
- No cross-process locking, network transport, UI, daemon, authentication,
  remote report store, or completion observer is shipped.
- No automatic Git cherry-pick/merge, migration, deployment, release, runtime
  switch, or external call is performed.

## Evidence boundary

Passing tests proves repository rules, Codex adapter-contract shape, and
simulations—not live cross-task completion behavior. Before a Codex release,
run the authorized synthetic acceptance plan on the exact installed version.
