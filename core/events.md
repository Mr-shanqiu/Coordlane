# Durable reports and events

Workers write complete reports to their own session or the configured durable
store. Notifications contain only routing metadata:

```json
{
  "worker_id": "20",
  "assignment_id": "assign-search-01",
  "event_type": "completed",
  "priority": "P1",
  "report_revision": 1,
  "report_digest": "sha256:..."
}
```

The complete schema is [`../schemas/event.schema.json`](../schemas/event.schema.json).

## Producer order

1. Finish bounded work and validation.
2. Construct the report and verify terminal-state invariants.
3. Persist it atomically as `durable`.
4. Compute and record its digest.
5. Emit an idempotent notification event.
6. Send one pure worker identifier to the bound Captain task.
7. Record a structured transport-issued receipt; a plain-text result or local
   tool-call ID proves only an attempt. Then return the same report to the worker
   session.

The reviewed plugin `Stop` Hook enforces this order, and `PostToolUse` records a
matching send receipt. A plain numeric wake without a durable revision and
digest is merely an opportunistic hint.

## Consumer order

1. Snapshot a high-water mark.
2. For each registered, non-archived worker, read events after its cursor.
3. Verify stable identity, revision, and digest against the durable report.
4. Mark discovered, consume idempotently, then advance the cursor.
5. Acknowledge the event only after consumption.
6. Independently validate the report before disposition or integration.

Advance a cursor only after successful application. Re-reading an event must
be harmless. A digest mismatch, missing report, stale attempt, or ownership
epoch mismatch stops consumption and creates a Captain-visible risk.

While the Captain sleeps, the durable ledger—not notification transport—is
truth. The one-shot terminal message wakes the Captain when transport works.
When transport is unavailable, the pending event is recovered at the next
Captain turn. Coordlane does not run scheduled heartbeat polling.

## Approval attention is not a terminal event

Codex `PermissionRequest` observations are stored in the worker ledger as
nonterminal Attention. They never enter the terminal event stream and never
carry raw tool input. Turn-entry and Pre-final snapshots may confirm
`needs_attention`; the Captain surfaces a redacted request once per active
turn. Coordlane 0.3.3 is observe-only: it does not auto-approve, hide, or
replace the native Codex approval prompt.
