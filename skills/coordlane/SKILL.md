---
name: coordlane
description: Coordinate complex work across multiple AI sessions with one Captain, stable worker registration, identity-bound assignments and acknowledgements, exclusive ownership, dependency gates, durable reports, quiet full-sweep discovery, independent validation, and traceable integration. Use when two or more AI sessions or logical agents share a mission, repository, dependency chain, user decision, or release boundary.
---

# Coordlane

Act as the Captain unless the user explicitly assigns a Crew role. Keep
coordination truth in explicit state, not in session titles or chat memory.

## Run the Captain loop

1. **Turn-entry full sweep.** Before handling each user message, take a
   non-blocking snapshot of every registered, non-archived formal Crew. Use
   `timeoutMs=0` or the host equivalent, each worker's cursor/revision, and read
   only changes. Drain every worker through a fixed high-water mark; a
   multi-target wait returns only the first change and is not a full sweep.
2. **Audit.** Confirm repository, workspace, branch, HEAD, dirty state,
   instructions, authoritative truth, active ownership, dependencies, runtime
   switches, external side effects, and token/CPU/network/call budgets.
3. **Plan the Chart.** Define Mission acceptance, Workstreams, dependencies,
   gates, shared entry points, stop conditions, and single-writer ownership.
4. **Register stable identity.** Store `role_id`, `worker_id`, `thread_id`,
   `host_id`, workspace, branch policy, capabilities, archived state, and
   cursor. Never route by title.
5. **Create the assignment.** Record `assignment_id`, `parent_decision_id`,
   `scope_version`, `attempt_id`, `origin`, ownership epoch, acceptance,
   forbidden resources, budgets, and one branch policy.
6. **Preflight before dispatch.** Block writes on dirty or wrong workspace,
   overlap, unmet dependency, unsafe runtime, insufficient budget, or unsettled
   truth. Unsettled truth permits only read-only audit or skeleton work.
7. **Close the dispatch transaction.** Treat message send as delivery only.
   Read the target and require acknowledgement: its latest user message
   contains the exact assignment ID, its assistant restates the bounded scope
   or starts the assigned action, and the active turn belongs to this
   assignment. Do not overwrite `user_direct` or `external` work.
8. **Consume reports quietly.** Require atomic durable report before event.
   Verify identity, attempt, ownership epoch, report revision, and digest;
   consume idempotently, advance cursor only after success, and acknowledge the
   event only after report consumption. Recover durable reports with lost
   events. Keep raw reports outside the user conversation.
9. **Validate independently.** Inspect scope and diff, reproduce proportional
   checks against the reported HEAD, review overlap, secrets, runtime state,
   and side effects, then accept, request revision, or reject. Worker-reported
   passing tests are not Captain-verified tests.
10. **Dock and release.** Integrate only after validation. Use either
    `ephemeral-cherry-pick` or `persistent-merge`; record source and integrated
    commits. Never auto-reset, rebase, force, merge, deploy, migrate, publish,
    or switch runtime state. Release ownership only with complete evidence.
11. **Pre-final full sweep.** After completing the core answer and before the
    final response, repeat the non-blocking full sweep. If relevant state
    changed, update the answer once. Do not recurse into a scan loop.

Also sweep after core work, at durable checkpoints during long tasks, and when
the user asks for status. Stay silent on unchanged snapshots. Surface only
completed outcome, risk, Captain validation, integration, next step, and needed
decisions.

## Enforce state boundaries

- Assignment: `draft -> dispatched -> delivered -> acknowledged -> running ->
  terminal -> validated -> integrated or revision/rejection -> closed`.
- Report: `building -> durable -> notified/discovered -> consumed -> validated
  -> archived`.
- Notification: `pending -> delivered -> acknowledged`.
- Never mark integrated without Captain validation.
- Never treat `completed` as Mission complete, released, integrated, deployed,
  or published.
- Never acknowledge delivery as report consumption.

## Apply quiet notification rules

Prefer a platform completion observer or reviewed post-turn hook. Otherwise
write the complete durable report first, then emit an event containing only
worker, assignment, type, priority, revision, and digest. Pending P1 terminal
events remain durable while Captain is active; P0 safety events surface at the
next tool boundary; P2 progress is query-only.

A pure numeric identifier can trigger an immediate global full sweep, but is an
opportunistic transport hint. Never require the same agent to call a tool after
its final answer. Never retry, loop, poll, or schedule numeric wake messages.

## Load companion resources

When installed with the repository, read only what the task needs:

- `../../core/state-machines.md`, `events.md`, `ownership.md`,
  `dependencies.md`, `branch-policy.md`, `handoff.md`, and `release-gates.md`;
- `../../schemas/` for machine-readable state;
- `../../adapters/interface.md` and only the current platform adapter;
- `../../templates/` for prompts, reports, and maps; and
- `../../docs/research/capability-matrix.md` before platform claims.

Unknown host capability downgrades to filesystem polling or manual operation.
Do not enable third-party hooks by default or claim an untested adapter as
working.

## Stop

Stop and report a curated risk when identity is ambiguous, stable binding is
missing, ownership overlaps, the baseline or truth changes, acknowledgement
fails, a digest mismatches, validation fails, authority is insufficient, or an
unapproved side effect would occur.
