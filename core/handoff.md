# Reports, handoff, and quiet discovery

## Durable terminal report

A terminal report is identified by `worker_id`, `assignment_id`, `attempt_id`,
`ownership_epoch`, `report_revision`, and `report_digest`. Its content follows
[`report.schema.json`](../schemas/report.schema.json). `completed`, `blocked`,
`decision_needed`, and `failed` describe only the assigned scope.

The producer order is report building, atomic durable write, digest, event, and
optional transport hint. A running commentary cannot emit a terminal event.
The strongest transport is a platform completion observer or reviewed post-turn
hook. Without one, numeric Radio is only an opportunistic hint.

## Full-sweep completeness gate

The Captain runs a non-blocking full sweep at **Turn-entry** and **Pre-final**,
plus after core work, at long-task checkpoints, and for user status requests.
Pre-final applies even when the current user question is unrelated to Crew.
Each sweep:

1. selects only registered, non-archived workers by stable ID;
2. recovers durable reports that have no event;
3. fixes an event high-water mark;
4. reads each worker after its independent cursor until no revision through the
   high-water mark remains;
5. verifies `assignment_id`, attempt, ownership epoch, `report_revision`, and
   digest before applying;
6. records the idempotency key and advances the cursor only after success; and
7. acknowledges delivery only after the report is consumed.

Use `timeoutMs=0` or an equivalent snapshot for thread-backed adapters.
Multi-target wait returns a first change and cannot replace this drain. No
change is completely silent. A degraded or failed scan is recorded and blocks
Dock or Launch when freshness matters.

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

Turn-entry and Pre-final cover only the interval in which a Captain turn is
active. After final, liveness requires an actual background heartbeat or event
broker. A worker prompt and pure numeric message cannot guarantee it.

Arm liveness only while a monitored Assignment is running or a terminal
revision is unread. The probe compares lightweight task status and cursors;
terminal, blocked, failed, or decision events wake the Captain for full ingest.
The durable event ledger retains completion even if notification delivery
fails. When no monitored work remains and unread count is zero, disarm the
heartbeat. If no broker exists, record `next_turn_only`: synchronization waits
for the next user or external wake and is not real-time.

## Notification queue and Radio

Events contain routing metadata, never report prose. P0 safety/data-loss events
may surface at the next tool boundary; P1 terminal events wait for a safe
point; P2 progress is query-only. Pending events remain durable while the
Captain is active and do not repeatedly disturb the user.

A message containing only a numeric Crew identifier may trigger an immediate
global full sweep. It is not the discovery mechanism. Never require an
impossible “send after final from the same turn.” Never retry, loop, poll, or
schedule numeric notifications in the core protocol.

## Handoff and release

Handoff transfers evidence or responsibility; completion does not release
files. Release requires commit disposition, checked workspace state, recorded
validation, a no-more-edits promise, overlap clearance, runtime and external
side-effect disclosure, and Captain confirmation. A new writer receives a new
ownership epoch so stale workers cannot resume writes.
