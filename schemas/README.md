# Schema boundary

The three JSON Schemas validate record shape and local invariants:

- `workstream.schema.json` requires scope, baseline, dependencies, gates, stop
  conditions, and side-effect authority;
- `report.schema.json` requires terminal evidence and prevents a Crew report
  from releasing ownership; and
- `ownership.schema.json` requires every release condition to be true before a
  claim can be marked `released`.

JSON Schema cannot reliably determine whether arbitrary filesystem patterns
overlap, whether one path is the parent of another, or whether two external
resource identifiers refer to the same mutable target. The Captain or a future
semantic validator must perform those checks before activation and release.
V1 tests include an exact-resource duplicate check but do not pretend to solve
host-specific path resolution.
