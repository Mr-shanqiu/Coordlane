---
name: coordlane
description: Coordinate complex work across multiple AI sessions with one Captain, bounded Crew workstreams, exclusive ownership, dependency gates, structured terminal reports, safe handoffs, and explicit control of integration and external side effects. Use when two or more AI sessions or agents will work on the same mission, especially when work may run in parallel, touch a shared repository, depend on ordered results, require user decisions, or culminate in merge, migration, deployment, or release.
---

# Coordlane

Coordinate the Mission through explicit contracts and evidence. Keep the core
platform-independent; load the matching adapter only after verifying that the
current host exposes the claimed capabilities.

## Run the coordination loop

1. **Audit first.** Confirm workspace, repository, branch, HEAD, dirty state,
   authoritative instructions, active ownership, dependencies, and external-
   side-effect boundaries before assigning writes.
2. **Define the Mission.** Record the outcome, acceptance criteria, constraints,
   user authority, and actions that require a new decision.
3. **Build the Chart.** Split the Mission into bounded Workstreams. Give each
   one a stable Crew ID, objective, owned and forbidden paths, shared entry
   points, baseline, dependencies, gates, stop conditions, and report contract.
4. **Check parallel safety.** Run Workstreams concurrently only when mutable
   paths and resources are disjoint and upstream gates have passed. Prefer an
   isolated branch or worktree for substantial code changes.
5. **Dispatch Crew.** Give each Crew the completed crew prompt from
   `../../templates/crew-prompt.md`. Require a read-only inventory before edits.
6. **Monitor with the dual turn gate.** On every user-facing turn, run a
   non-blocking scan after the user message and before work, then another after
   preparing the answer and before the final response. Scan only registered,
   non-archived formal execution sessions; use stored cursors or revisions to
   read only changes and stay silent when none exist.
7. **Review terminal reports.** Accept `completed`, `blocked`, or
   `decision_needed` only when the status matches evidence. Treat Crew
   completion as local to its authorized Workstream.
8. **Release ownership explicitly.** Require commit disposition, clean-state
   check, validation evidence, no-more-edits commitment, overlap review,
   runtime disclosure, and shared-entry-point handoff.
9. **Dock deliberately.** Re-run integration-level verification before merge or
   reassignment. Keep shared entry points under one writer.
10. **Launch only with authority.** Captain alone coordinates runtime switches,
    migrations, deployments, releases, and other external side effects.

## Enforce invariants

- Never allow two writers to own the same path or mutable resource.
- Never let Crew expand scope or edit an unowned shared entry point.
- Never equate a flat task list with Mission state; maintain dependencies,
  ownership, gates, decisions, and Runtime State.
- Never equate `completed` with released, integrated, deployed, or Mission done.
- Never paste raw Crew reports into the user's main conversation unless asked;
  summarize conclusions, risks, and decisions.
- Never assume a host has Codex-like thread APIs. Unknown capability degrades to
  Polling or Manual.
- Never enable third-party hooks by default.

## Enforce the dual turn gate

Treat Crew notification as a fast path, never a completeness guarantee. For
both the turn-entry and pre-final scan, use `timeoutMs=0` or an equivalent
non-blocking snapshot. Absorb changed reports privately, update coordination
state, and show the user only relevant conclusions, risks, and decisions.

Any message containing only a numeric identifier triggers an immediate global
scan, but does not replace either mandatory turn scan. If pre-final changes
affect the draft, revise it once; never recurse into a scan loop. Do not scan
unregistered helpers or archived sessions. Do not paste raw reports into the
Captain conversation or create a background polling loop.

## Use terminal reports

Require this exact header:

```text
[REPORT][{crew_id}][completed|blocked|decision_needed]
```

Then require task, workspace/branch/HEAD, completed work, commit disposition,
validation, modified or occupied paths, overlap, Runtime State, required
decision, and next step. Use `../../templates/report.md` for the full form.

## Apply Radio conservatively

Radio is optional. At a terminal state, query Captain status once. Send one
message containing only the Crew ID only if the status is explicitly and
freshly idle. Send nothing for active, unknown, stale, unavailable, failed, or
not-loaded state. Never attach a summary, retry, loop, poll, schedule a timer,
or create an automation. The Captain's dual turn gate remains mandatory because
Radio is best-effort.

Disable Radio when the adapter cannot verify idle state without interruption.

## Read project resources as needed

When this Skill is used from the full repository and the companion paths exist:

- Read `../../core/` before defining or changing protocol semantics.
- Read `../../schemas/` when producing machine-readable project state.
- Read only the relevant directory under `../../adapters/` after identifying
  the host.
- Use `../../templates/` to create Captain prompts, Crew prompts, reports, and
  project maps.
- Read `../../docs/research/capability-matrix.md` before making a platform
  capability claim.

When installed as a standalone Skill, use the invariants and report contract in
this file and ask the user for any project-specific map or adapter. Do not
invent missing companion content.

## Stop conditions

Stop and report when workspace identity is wrong, ownership overlaps, the
baseline changed unexpectedly, a required gate fails, user authority is
insufficient, or continuing would cause an unapproved external side effect.
