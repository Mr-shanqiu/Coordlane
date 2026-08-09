# Coordlane

> One coordinating brain for safe parallel work, quiet handoffs, and traceable
> integration across AI tasks.

[简体中文](README.zh-CN.md)

Coordlane is a local-first Codex plugin for complex
work split across one Captain and multiple bounded Crew tasks. It keeps scope,
stable identity, dependencies, file ownership, report evidence, validation,
and integration state explicit—without turning raw worker output into user
conversation noise.

The current implementation phase targets **Codex desktop only**. Other platform
directories are deferred research notes, not support claims.

## What it fixes

- Message delivery is separated from target acknowledgement.
- Stable `thread_id + host_id` replaces unreliable title routing.
- Assignment origin prevents Captain dispatch from overwriting user-direct
  work.
- Exclusive ownership and dependency preflight block unsafe parallel writes.
- Terminal reports are revisioned, digest-bound, and durable before events.
- A reviewed `Stop` Hook requires terminal evidence and a one-shot Captain
  notification before a Crew can finish normally.
- Turn-entry and pre-final full sweeps discover results even when wake messages
  are lost, early, or impossible after final output.
- An executable finalizer refuses an answer when the current turn lacks a fresh
  registry-wide Pre-final sweep or terminal results remain unread.
- Captain verification is separate from worker-reported tests.
- Explicit branch policy prevents cherry-pick and persistent-workstream history
  from being mixed.
- Integration records worker and integrated commits; completion never implies
  release, deployment, or Mission completion.

## Architecture

Coordlane uses a **Captain** as the user-facing coordinating brain and **Crew**
as bounded execution tasks. The **Chart** tracks Workstreams and dependencies;
the **Logbook** stores structured evidence; **Dock** is controlled integration;
**Launch** is an explicitly authorized migration, deployment, or release.
**Radio** is only an optional transport hint.

Read the [architecture](docs/architecture.md),
[state machines](core/state-machines.md),
[event protocol](core/events.md),
[ownership rules](core/ownership.md), and
[branch policy](core/branch-policy.md).

## Current runnable surface

- one installable Codex plugin with a bundled [`coordlane` Skill](skills/coordlane/SKILL.md);
- reviewed `Stop` and `PostToolUse` lifecycle [Hooks](hooks/hooks.json);
- Captain, Crew, report, and project-map [`templates/`](templates/);
- seven machine-readable [`schemas/`](schemas/);
- a Node.js standard-library [filesystem reference](reference/README.md);
- a current-host [Codex desktop adapter](adapters/codex/README.md); and
- 15 executable failure-scenario tests plus schema, formatting, link, sample
  safety, and adapter-contract checks.

Coordlane ships no server, daemon, scheduled heartbeat, telemetry, transcript
store, secret handler, automatic merge, deployment, migration, release, or
runtime switch. Plugin Hooks do not run until the user reviews and trusts their
exact definitions.

Turn scans provide active-turn consistency. Sleeping liveness uses a one-shot
Crew notification after its durable event exists. If delivery fails, the event
remains pending and the next Captain turn recovers it; Coordlane does not spend
quota on recurring polling or describe degraded delivery as real-time.

## Quick start

```sh
npm install
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/coordlane
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
```

The plugin is the only installation unit. Do not install or copy its bundled
Skill separately. During local development, validate the repository as above;
after the plugin is published or added to an approved marketplace, install the
`coordlane` plugin and review its Hooks. Start the coordinating task with
[`templates/captain-prompt.md`](templates/captain-prompt.md), fill
[`templates/project-map.md`](templates/project-map.md), and dispatch each formal
Crew with a completed [`templates/crew-prompt.md`](templates/crew-prompt.md).

Use the filesystem model locally:

```sh
node reference/coordlane.mjs init .coordlane fictional-library
node reference/coordlane.mjs bind-captain .coordlane captain-thread local
node reference/coordlane.mjs status .coordlane
node reference/coordlane.mjs sweep .coordlane
```

## Codex reliability rules

Current Codex desktop task tools provide stable IDs, listing, reading,
delivery, bounded waiting, cursors, and archival. Coordlane uses Level 2
orchestration with reviewed lifecycle Hooks:

1. dispatch with an `assignment_id`;
2. verify target acknowledgement by reading the task;
3. maintain one cursor per registered, non-archived Crew;
4. run non-blocking full sweeps at turn entry and pre-final;
5. treat multi-target wait as first-change latency optimization only;
6. consume only durable, matching report revisions; and
7. require durable report/event before a one-shot pure numeric wake;
8. use `PostToolUse` to record delivery and `Stop` to enforce the terminal
   gate; and
9. treat the wake as a hint, never truth or completeness.

The Pre-final gate applies to every answer, including questions unrelated to
Crew. Scan failure records `freshness=unknown`; Coordlane must not claim that
task state is synchronized.

## Project status and boundaries

The protocol, reference store, schemas, and simulated failure tests are
runnable locally. An authorized projectless Codex acceptance passed stable
identity, create, delivery/ACK separation, first-change wait, per-task cursor
drain, unchanged suppression, structured final, and archive. Worktree and
cryptographic durable-report checks remain open. See the
[acceptance record](docs/testing/codex-live-acceptance-2026-08-09.md) and
[self-audit](docs/self-audit.md).

No GitHub Release or external PR is created by this phase. Migration from early
Agent Captain drafts is documented in
[`docs/migration-from-agent-captain.md`](docs/migration-from-agent-captain.md).

Prior art was reviewed for independent positioning; see
[`docs/research/prior-art.md`](docs/research/prior-art.md). This is not legal or
trademark advice.

## License

[MIT](LICENSE)
