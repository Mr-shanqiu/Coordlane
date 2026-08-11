# Schema boundary

Current store schema version: **1.1.0**.

Opening a Coordlane 0.3.2 store at schema `1.0.0` performs a locked,
restart-safe compatibility migration. It fills Attention and notification
attempt fields, binds validation/integration envelopes, recomputes migrated
report digests and matching event references, atomically writes each record,
and writes the project version last. New stores start at `1.1.0`. Unknown or
future versions fail closed instead of being guessed. Legacy records are
accepted only inside that project-led migration. Every normal store access
checks `project`, `registry`, `ledger`, `ownership`, `assignment`, `report`, and
`event` records for exactly `1.1.0` before status, sweep, or Hook logic proceeds;
mixed, missing, future, or unknown child versions fail closed. JSON outside the
Coordlane state store, including command payloads and schema fixtures, is not
treated as a state record.

Seven JSON Schemas define Coordlane's current records:

- `assignment.schema.json`: identity, origin, scope, attempt, delivery, ACK,
  disposition, and integration;
- `registry.schema.json`: stable worker routing, capabilities, cursor, and
  archive state;
- `ledger.schema.json`: per-worker discovery, consumption, validation,
  turn-bound live-sweep attestations, scan-call limit, and finalization freshness;
- `event.schema.json`: metadata-only, digest-bound notification events and
  one-shot attempt evidence;
- `report.schema.json`: immutable terminal evidence plus lifecycle and Captain
  validation envelopes bound to revision, digest, and subject HEAD;
- `workstream.schema.json`: scope, dependency, runtime authority, and branch
  policy contract; and
- `ownership.schema.json`: canonical resource, epoch fencing, and release
  evidence.

Schemas validate record shape and local invariants. Runtime semantic checks must
still detect parent/child path overlap, duplicate mutable targets, illegal
state transitions, stale attempts or epochs, digest mismatches, dependency
invalidation, and branch-policy conflicts. The reference implementation and
failure-scenario tests cover the current semantic subset.
