# P0: terminal wake can be sent before the Crew turn is terminal

- Status: Open
- Recorded: 2026-08-13
- Affected release: 0.3.4
- Scope: Codex adapter and lifecycle Hooks

## Field symptom

A Crew can call `send_message_to_thread` with its worker ID during commentary,
before its final response exists. The Captain reacts immediately, reads the
Crew while it is still active, finds no terminal report, and may then omit that
Crew from the later result intake.

This creates a false wake: delivery succeeded, but the terminal artifact was
not ready for consumption.

## Current cause

The durable state model already rejects terminal events without a matching
durable report. The installed Hook, however, only evaluates a notification in
`PostToolUse`. When the terminal gate is not ready it silently ignores that
tool result; it does not prevent the message from being sent in `PreToolUse`.

Consequently:

- the Captain can be interrupted too early;
- the early attempt is not recorded in Coordlane's event ledger;
- a later valid wake is not guaranteed by the premature attempt;
- Turn-entry and Pre-final full sweeps provide eventual active-turn recovery,
  but do not make the false wake correct.

## Required correction

1. Add a Crew-side `PreToolUse(send_message_to_thread)` terminal gate.
2. Permit the pure worker-ID notification only when the report and its
   digest-bound terminal event are durable and match the active assignment.
3. Block premature and duplicate terminal notification attempts before the
   host sends them.
4. Record a minimal sanitized audit fact for a blocked premature attempt:
   worker ID, assignment ID, timestamp, reason, and event/report revision when
   available. Do not store report prose, conversation content, or tool input.
5. Keep the Captain's registry-wide Turn-entry and Pre-final sweeps as the
   authoritative discovery path. A wake remains a transport optimization.
6. When a wake arrives but the worker is still active, retain the worker as
   pending and require a later changed-cursor or terminal-ledger check; never
   mark the notification consumed from a live partial turn.

The correction must not add heartbeat polling, background model turns, or
quota-consuming retry loops.

## Acceptance scenarios

1. A Crew attempts a pure-ID wake during commentary: the Hook blocks delivery
   and records a redacted `premature_wake_blocked` audit fact.
2. A matching report and event are durable: exactly one pure-ID wake is
   allowed and its structured delivery receipt is recorded.
3. A second wake for the same report revision is blocked as a duplicate.
4. The Captain receives a wake while the Crew is still active: the assignment
   remains pending and is discovered after the terminal revision appears.
5. No valid wake is delivered: the next Turn-entry or Pre-final full sweep
   still ingests the durable terminal event once and only once.

## Logging boundary

Coordlane currently provides a structured local state and audit ledger under
the repository's shared Git directory (`.git/coordlane`), not a traditional
continuous runtime log. Reports and terminal events are durable and revisioned;
the ledger tracks discovery and adjudication; Hook receipts prove selected
lifecycle events. Raw conversations, telemetry, and general tool activity are
not retained.

The premature-notification path described here is a known audit blind spot in
0.3.4 because the current `PostToolUse` handler returns before recording an
attempt when the terminal gate is not ready.
