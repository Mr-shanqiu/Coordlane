# Schema boundary

Seven JSON Schemas define Coordlane's current records:

- `assignment.schema.json`: identity, origin, scope, attempt, delivery, ACK,
  disposition, and integration;
- `registry.schema.json`: stable worker routing, capabilities, cursor, and
  archive state;
- `ledger.schema.json`: per-worker discovery, consumption, and validation
  revisions plus finalization freshness and gate evidence;
- `event.schema.json`: metadata-only, digest-bound notification events;
- `report.schema.json`: immutable terminal evidence plus lifecycle and Captain
  validation envelopes;
- `workstream.schema.json`: scope, dependency, budget, runtime, and branch
  policy contract; and
- `ownership.schema.json`: canonical resource, epoch fencing, and release
  evidence.

Schemas validate record shape and local invariants. Runtime semantic checks must
still detect parent/child path overlap, duplicate mutable targets, illegal
state transitions, stale attempts or epochs, digest mismatches, dependency
invalidation, and branch-policy conflicts. The reference implementation and
failure-scenario tests cover the current semantic subset.
