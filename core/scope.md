# Scope and design boundary

## Purpose

Coordlane defines a portable coordination contract for complex work split
across multiple AI sessions. Its core value is not spawning agents. Its value
is maintaining a single accountable view of Mission state, ownership,
dependencies, evidence, decisions, and release authority.

## Normative entities

- **Mission**: final objective, constraints, acceptance criteria, and authority.
- **Workstream**: bounded unit of work with one accountable Crew.
- **Ownership**: exclusive control of paths, resources, or shared entry points.
- **Dependency**: an ordering or evidence requirement between Workstreams.
- **Gate**: a condition that must pass before integration or external action.
- **Checkpoint**: a verified state where work can stop safely.
- **Report**: a terminal, structured record from one Crew.
- **Handoff**: transfer or release of artifacts and responsibility.
- **Runtime State**: switches, processes, migrations, deployments, and other
  external side effects.
- **Decision**: a choice reserved for the Captain or user.

## Goals

1. Keep one Captain accountable for global coordination.
2. Make Crew scope, ownership, dependencies, and stop conditions explicit.
3. Prevent concurrent writers on shared files and resources.
4. Separate Workstream completion from file release and Mission completion.
5. Require evidence before integration, migration, deployment, or release.
6. Degrade safely when a host lacks native session APIs.
7. Keep platform claims dated, sourced, and independently verifiable.

## Non-goals for V1

V1 is not a server, task database, chat client, agent runtime, permanent
watcher, deployment tool, merge bot, credential broker, telemetry system, or
conversation archive. V1 does not run scheduled heartbeat polling and does not
make plugin Hooks trusted without explicit user review.

## Differentiation boundary

V1 is intentionally narrower than full orchestration runtimes. It is a
schema-backed governance protocol and adapter guide that can operate manually.
The public core contains no host API names. It does not import implementation,
terminology systems, or prose from adjacent orchestration projects. See
[`docs/research/prior-art.md`](../docs/research/prior-art.md).
