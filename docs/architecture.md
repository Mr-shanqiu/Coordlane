# Coordlane architecture

Coordlane separates coordination truth from platform transport. A Captain owns
the Mission view; Crew sessions execute bounded Assignments. Durable files make
completion discoverable even when a notification is lost or the Captain
restarts.

```text
user <-> Captain
          |-- registry + assignment ledger + ownership claims
          |-- adapter interface -> platform sessions or logical workers
          |-- safe-point full sweep <- notification queue
          |                         <- durable report store
          `-- validation -> Dock -> Launch gate
```

## Truth layers

1. **Registry** binds `worker_id` and `role_id` to stable `thread_id` plus
   `host_id`, workspace, branch policy, capabilities, and cursor. Titles are UI
   labels only.
2. **Assignment ledger** records decision, scope version, origin, delivery,
   acknowledgement, attempts, validation, and integration disposition.
3. **Ownership ledger** fences mutable resources with an `ownership_epoch`.
4. **Report store** holds immutable, digest-bound report revisions. A worker's
   prose response is not the coordination database.
5. **Notification queue** carries metadata only. It never contains raw report
   prose and never becomes report truth.
6. **Consumption ledger** records per-worker cursors and discovered, consumed,
   and validated revisions for idempotent recovery.

## Reliable coordination loop

Dispatch is a transaction:

```text
decision -> dispatch -> delivery -> target acknowledgement -> running
```

Delivery proves only that transport accepted a message. Acknowledgement requires
the target's latest user message to contain the `assignment_id`, the assistant
to restate the scope or first action, and the active turn to match that
assignment. `origin=user_direct` or `external` work must not be overwritten.

Completion is another transaction:

```text
build report -> atomic durable write -> digest -> event -> one-shot wake
-> Stop gate -> full sweep -> consume -> Captain validation
-> integrate or revise -> close and release
```

A live sweep covers every registered, non-archived worker with an active
assignment, using its stored cursor. `PostToolUse(wait_threads)` binds observed
stable addresses to the current `turn_id`; draining the local mailbox alone is
not sufficient. One batched zero-time snapshot is attempted first, followed by
only the targets absent from that response. The mailbox pass recovers durable
reports that lack events, repairs the event high-water mark, and drains each
worker through that boundary.

## Safe points

Run a bounded, non-blocking full sweep at turn entry, after the core user task,
before the final response, at durable checkpoints in long work, and whenever
the user asks for status. A pure numeric Crew identifier may request an
immediate sweep, but it is not a completeness mechanism.

P0 safety or data-loss events may be surfaced at the next tool boundary. P1
terminal results wait for a safe point. P2 progress is query-only. The user
sees curated outcomes, risk, validation status, integration status, next step,
and decisions—not raw Crew reports.

The finalizer enforces this mechanically. `beginTurn` invalidates the previous
pass and records the active registry revision; tool Hooks attest entry and
pre-final live snapshots; `preFinalGate` drains durable events; and
`assertFinalizable` rejects output if either live attestation or mailbox gate is
missing, stale, unknown, over budget, or has unread terminal revisions. Topic
relevance never bypasses this guard.

## Two reliability domains

**Active-turn consistency** uses Turn-entry, safe-point, and Pre-final sweeps
while the Captain is executing. **Sleeping-controller liveness** uses the
Crew's plugin-enforced, one-shot terminal wake after the durable event exists.
If delivery degrades, the event remains pending for the next Captain turn.
Coordlane runs no scheduled heartbeat polling.

The plugin is the only installation unit. Its bundled Skill carries the model
workflow; `Stop` enforces terminal evidence and `PostToolUse` records a matching
delivery receipt. Hooks remain inactive until the user reviews and trusts them.

## Security and resource model

Coordlane treats worker reports as untrusted claims until the Captain checks
scope, diff, subject HEAD, relevant tests, secret disclosure, runtime state,
and external side effects. It stores no transcript or secret and performs no
automatic merge, deployment, migration, or release. Per-assignment token, CPU,
network, and external-call budgets are part of preflight.

Task snapshot cost is bounded. No active assignment produces no snapshot calls.
There is no scheduled polling, and the Hook refuses observations after the
per-turn call budget instead of silently spending more quota.

The runnable filesystem reference is documented in
[`../reference/README.md`](../reference/README.md). Git projects keep state in
their Git common directory so worktrees share one private local store. Critical
multi-file changes use a bounded cross-process lock, but the store is still a
same-user trust boundary rather than a distributed or hostile-process service.
