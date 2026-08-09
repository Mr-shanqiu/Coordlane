# Reports, handoff, and Radio

## Terminal report

Each terminal Crew response uses this shape:

```text
[REPORT][{crew_id}][completed|blocked|decision_needed]

Task:
Workspace / branch / HEAD:
Completed work:
Commit (or none):
Validation and results:
Modified / occupied paths:
Shared files or overlap:
Runtime switches and external side effects:
Captain decision required:
Suggested next step:
```

Use [`templates/report.md`](../templates/report.md) for the bilingual human
form and [`schemas/report.schema.json`](../schemas/report.schema.json) for
machine-readable records.

## Handoff

A handoff transfers artifacts or responsibility; it does not automatically
release ownership. Include the artifact location, commit disposition,
verification, known limitations, shared-entry-point actions, and the intended
next owner. The Captain completes the transfer only after the release rule in
[`ownership.md`](ownership.md) passes.

## Conditional Radio

Radio is an optional terminal notification, not the coordination core.

At `completed`, `blocked`, or `decision_needed`, a Crew may:

1. keep the full report in its own context;
2. query Captain status once immediately before its final response;
3. send exactly one message containing only its Crew ID when the Captain is
   explicitly and freshly reported as idle; and
4. send nothing when status is active, unavailable, unknown, stale, failed, or
   not loaded.

The Crew must not attach a summary, retry, loop, poll, schedule a timer, or
create a background automation. Each terminal transition permits at most one
Radio message.

## Captain silent pull

Radio delivery is best-effort. At natural checkpoints, the Captain should use
the host's bounded status/read operation to inspect all assigned Crew sessions.
The Captain then synthesizes results without pasting raw reports into the main
user conversation.

If a host cannot verify idle state or deliver a single message without
interrupting work, the adapter must disable Radio and fall back to bounded
polling or manual handoff.
