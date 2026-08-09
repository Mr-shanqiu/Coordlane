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

## Captain dual turn gate

Radio delivery is best-effort and is never the completeness mechanism. The
Captain must run both of these coordination scans on every user-facing turn:

1. **Turn-entry scan**: after receiving the user's message and before handling
   it, scan every registered, non-archived formal execution session.
2. **Pre-final scan**: after preparing the answer and before emitting the final
   response, scan the same registry again.

Each scan must:

- use `timeoutMs=0` or an equivalent non-blocking snapshot;
- pass the last stored cursor, revision, or change token for each session and
  read only sessions whose state changed;
- remain completely silent when nothing changed;
- absorb changed reports in the background, update the Chart, ownership,
  gates, decisions, and Runtime State, and perform only integration or
  dispatch actions already within the Captain's authority; and
- expose only relevant conclusions, risks, and decisions to the user, never a
  raw Crew report in the Captain conversation.

If the pre-final snapshot changes a user-relevant conclusion, revise the draft
once after absorbing it and then respond. Do not turn the gate into a recursive
scan loop.

The Captain must maintain a registry containing the stable session handle,
formal/archived state, and latest cursor or revision. Ad hoc chats, unregistered
helpers, and archived sessions are outside the scan set.

Any message whose entire content is a numeric identifier may trigger an
immediate global scan of all registered, non-archived execution sessions. That
fast path does not replace either turn gate. The Captain may also scan at other
natural checkpoints, but must not create a daemon or repeated polling loop.

If a host cannot verify idle state or deliver a single message without
interrupting work, the adapter must disable Radio and fall back to bounded
polling or manual handoff.
