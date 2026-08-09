# Reports, handoff, and quiet discovery

## Durable terminal report

A terminal report is identified by `worker_id`, `assignment_id`, `attempt_id`,
`ownership_epoch`, `report_revision`, and `report_digest`. Its content follows
[`report.schema.json`](../schemas/report.schema.json). `completed`, `blocked`,
`decision_needed`, and `failed` describe only the assigned scope.

The producer order is report building, atomic durable write, digest, event,
one-shot transport hint, and delivery receipt. A running commentary cannot emit
a terminal event. The plugin `Stop` Hook enforces the boundary; numeric Radio
remains only an opportunistic hint.

## Full-sweep completeness gate

The Captain runs a non-blocking full sweep at **Turn-entry** and **Pre-final**,
plus after core work, at long-task checkpoints, and for user status requests.
Pre-final applies even when the current user question is unrelated to Crew.
Each sweep:

1. selects registered, non-archived workers with active assignments by stable
   ID; an idle registry completes with zero task-tool calls;
2. recovers durable reports that have no event;
3. fixes an event high-water mark;
4. reads each worker after its independent cursor until no revision through the
   high-water mark remains;
5. verifies `assignment_id`, attempt, ownership epoch, `report_revision`, and
   digest before applying;
6. records the idempotency key and advances the cursor only after success; and
7. acknowledges delivery only after the report is consumed.

Use `timeoutMs=0` or an equivalent snapshot for thread-backed adapters. Try one
batch, then query only targets not evidenced in that response. The Hook records
actual target coverage against the current `turn_id`; a local mailbox sweep
alone cannot pass the gate. No change is completely silent. A degraded,
over-budget, or failed scan records unknown freshness and blocks Dock or Launch
when freshness matters.

If Pre-final changes a user-relevant conclusion, update the answer once and
finish; do not recurse indefinitely. The raw report remains in the worker
channel or report store. The user receives only outcome, risk, independent
validation status, integration status, next step, and decisions.

Pre-final is an executable finalizer guard, not a prompt convention. Starting a
new turn invalidates the prior pass. The guard refuses final output when the
registry has monitored workers or unread terminal results and this turn lacks a
successful full sweep. Persist `last_sweep_at`, `last_sweep_cursor`,
`unread_terminal_count`, `final_gate_passed`, and `freshness`. If the scan tool
is unavailable or fails, set `freshness=unknown`; never claim synchronization.

## Sleeping-controller liveness

Turn-entry and Pre-final cover the active Captain turn. Sleeping liveness uses
the Crew's Hook-gated, one-shot terminal notification. The durable event ledger
retains completion if delivery fails, and the next Captain turn recovers it.
Coordlane does not run recurring heartbeat polling or claim real-time delivery
after a degraded notification.

## Notification queue and Radio

Events contain routing metadata, never report prose. P0 safety/data-loss events
may surface at the next tool boundary; P1 terminal events wait for a safe
point; P2 progress is query-only. Pending events remain durable while the
Captain is active and do not repeatedly disturb the user.

A message containing only a numeric Crew identifier may trigger an immediate
global full sweep. It is not the discovery mechanism. Send it once before
final, after durable event creation. Never retry, loop, poll, or schedule
numeric notifications in the core protocol.

## Handoff and release

Handoff transfers evidence or responsibility; completion does not release
files. Release requires commit disposition, checked workspace state, recorded
validation, a no-more-edits promise, overlap clearance, runtime and external
side-effect disclosure, and Captain confirmation. A new writer receives a new
ownership epoch so stale workers cannot resume writes.
