# Terminal report template

```text
[REPORT][{worker_id}][completed|blocked|decision_needed|failed]

Assignment / attempt / scope / ownership epoch:
Objective:
Workspace / branch / HEAD:
Completed work:
Commit (or reason for none):
Worker verification, exact result, and subject HEAD:
Modified or owned files/resources:
Shared overlap:
Runtime switches, processes, external side effects, and cleanup:
Secrets exposure statement:
Blockers:
Decisions needed:
Recommended next action:
Report revision / digest:
No-more-edits commitment:
```

`completed` requires nonempty completed work, passing worker checks, and no open
overlap, blocker, or decision. `blocked` and `failed` require blockers;
`decision_needed` requires a concrete choice. Captain validation is separate
and must not be filled by Crew.

Use [`../schemas/report.schema.json`](../schemas/report.schema.json) for the
machine-readable record. Its digest covers stable assignment identity and
immutable content; lifecycle and Captain validation are mutable envelopes.
