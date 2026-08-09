# Adapter interface

Adapters map host-specific tools to these platform-neutral operations:

```text
create_worker
dispatch_assignment
read_worker
wait_worker
persist_report
emit_event
deliver_notification
enforce_terminal_gate
record_delivery_receipt
scan_events
ack_event
archive_worker
workspace_status
integrate_change
```

`dispatch_assignment` returns delivery evidence, not acknowledgement.
`read_worker` must use stable IDs and expose assignment origin. `wait_worker`
may return the first changed worker and never substitutes for `scan_events`
across all registered workers. `persist_report` must complete before
`emit_event`. `integrate_change` is always gated by Captain validation and
explicit branch policy.

`deliver_notification` is one-shot and never carries report prose.
`enforce_terminal_gate` verifies durable evidence before a worker stops, while
`record_delivery_receipt` separates transport delivery from Captain
consumption. Without these operations, sleeping results synchronize at the
next Captain turn.

## Capability levels

1. **Level 1 — Native orchestration:** thread create/list/read/send/wait,
   stable IDs, completion observer, and workspace isolation are available.
2. **Level 2 — Native threads with lifecycle gate:** use thread APIs, durable
   reports, a reviewed terminal Hook, one-shot wake, and safe-point sweeps.
3. **Level 3 — No thread API:** use a shared filesystem mailbox, atomic
   temporary-write plus rename, per-worker report directories, and cursors.
4. **Level 4 — Single chat:** simulate logical workers sequentially while
   preserving assignments, ownership, dependencies, and evidence.

An adapter documents each operation as verified, experimental, unavailable,
or manual, cites evidence, and names its downgrade. It must not infer support
from a marketing description.
