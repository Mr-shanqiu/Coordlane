# Generic prompt adapter

> Deferred fallback note. This path is not part of current Codex-only
> conformance testing and is not an active compatibility claim.

## Classification

**Manual.** No session, hook, messaging, or status API is assumed.

## Workflow

1. Copy the Captain prompt into one coordinating session.
2. Create the project map in a location the user approves.
3. Start separate Crew sessions and paste a completed Crew prompt into each.
4. Isolate writable code work with branches or worktrees when supported by the
   project toolchain.
5. Maintain a registry of formal, non-archived Crew sessions and a last-seen
   revision or timestamp for each durable report.
6. At turn entry and pre-final, perform a non-blocking manual snapshot of that
   registry and copy only changed reports to the Captain's private working
   context.
7. Let the Captain update ownership, dependencies, and gates, while showing the
   user only synthesized conclusions, risks, and decisions.

Radio is disabled because the host cannot prove fresh idle state. Manual copy
is a valid, safe degradation path, not a compatibility failure.
