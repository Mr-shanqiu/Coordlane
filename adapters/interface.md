# Adapter interface

Adapters map host-specific tools to these platform-neutral operations:

```text
create_worker
dispatch_assignment
read_worker
wait_worker
persist_report
emit_event
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

## Capability levels

1. **Level 1 — Native orchestration:** thread create/list/read/send/wait,
   stable IDs, completion observer, and workspace isolation are available.
2. **Level 2 — Native threads, no completion observer:** use thread APIs plus
   durable reports; wake is opportunistic and safe-point polling is required.
3. **Level 3 — No thread API:** use a shared filesystem mailbox, atomic
   temporary-write plus rename, per-worker report directories, and cursors.
4. **Level 4 — Single chat:** simulate logical workers sequentially while
   preserving assignments, ownership, dependencies, and evidence.

An adapter documents each operation as verified, experimental, unavailable,
or manual, cites evidence, and names its downgrade. It must not infer support
from a marketing description.
