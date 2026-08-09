# Dependencies, gates, and checkpoints

## Dependency graph

The Chart is a directed acyclic graph of Workstreams and evidence. A dependency
must state what the downstream Workstream consumes: a commit, artifact, schema,
decision, test result, or released path.

Do not represent the Mission with a flat task list alone. A task can be marked
complete while a required gate or ownership release remains open.

## Gate types

- **Baseline gate**: correct workspace, branch, HEAD, and authoritative input.
- **Scope gate**: disjoint ownership and explicit shared entry points.
- **Verification gate**: required checks pass against the intended artifact.
- **Release gate**: ownership release evidence is complete.
- **Integration gate**: dependent work is compatible and reviewed together.
- **Launch gate**: the user or authorized Captain approves external action.

## Checkpoints

A Checkpoint is a safe stopping state with durable evidence and a next bounded
action. Use one before a risky operation, context handoff, or user decision.
Checkpoint records must not contain secrets or full conversation transcripts.

## Changes to the Chart

Only the Captain changes dependency order, ownership, or gate requirements.
Crew sessions may propose a change in `decision_needed`, but must not proceed on
the assumption that the proposal was accepted.

When an upstream truth source, scope, or accepted artifact changes, the Captain
marks affected downstream Workstreams `stale`. Their prior completion remains
historical evidence, not current readiness. Writes resume only through a new
scope version, attempt, dependency disposition, and ownership epoch.
