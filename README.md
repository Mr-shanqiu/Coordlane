# Coordlane

> A quota-conscious reliability layer for coordinating existing Codex tasks:
> one responsive Captain, bounded Crew, quiet durable handoffs, and traceable
> integration.

[简体中文](README.zh-CN.md)

Coordlane is a local-first Codex plugin for complex
work split across one Captain and multiple bounded Crew tasks. It keeps scope,
stable identity, dependencies, file ownership, report evidence, validation,
and integration state explicit—without turning raw worker output into user
conversation noise.

The Captain is a responsive, non-blocking control plane. It communicates,
coordinates, reviews evidence, and authorizes state transitions, but it does
not edit project files, run builds or tests, wait on workers, or execute
integration and release work. Validator and Dock Crew perform those bounded
operations under explicit Assignments.

The current implementation phase targets **Codex desktop only**. Other platform
directories are deferred research notes, not support claims.

## Why Coordlane

Coordlane is deliberately narrower than an agent IDE, autonomous swarm, or
general software-development methodology. It coordinates Codex tasks that the
user already has, while keeping the main task available for conversation and
decision-making.

Its core advantage is the combination of these reliability boundaries:

- **A non-blocking Captain.** The user-facing task coordinates but never edits
  project files, runs builds or tests, waits on workers, or performs integration.
- **Identity-bound dispatch.** Stable task identity, `assignment_id`, origin,
  and explicit ACK separate message delivery from acceptance of the right work.
- **Safe parallelism before execution.** Exclusive ownership and dependency
  preflight stop overlapping writes, stale baselines, and premature downstream
  work before a Crew starts.
- **Durable, quiet handoffs.** Revisioned reports and terminal events are bound
  by digest before a one-shot Hook notification. Raw Crew output stays outside
  the user conversation.
- **Two active-turn completeness gates.** Registry-wide Turn-entry and Pre-final
  zero-time sweeps recover changed Crew state even when a wake hint is missing;
  the finalizer fails closed on stale or unknown freshness.
- **Evidence before integration.** A separate Validator produces independent
  evidence and one authorized Dock Crew is the only integration writer.
- **Reliability without recurring quota spend.** Coordlane has no heartbeat,
  daemon, retry polling, or background AI patrol. It uses bounded incremental
  snapshots and leaves a failed notification durable for the next Captain turn.

This is not a claim of overall superiority. Projects such as
[Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator),
[Gas Town](https://github.com/gastownhall/gastown),
[Superpowers](https://github.com/obra/superpowers),
[Ruflo](https://github.com/ruvnet/ruflo), and
[Warren](https://github.com/jayminwest/warren) offer broader user interfaces,
agent/runtime coverage, continuous operation, autonomous workflows, or complete
development methods. Choose them when those capabilities matter more than a
small Codex-native coordination safety layer. See the dated
[prior-art review](docs/research/prior-art.md) for the comparison and limits.

## What it fixes

- Message delivery is separated from target acknowledgement.
- Stable `thread_id + host_id` replaces unreliable title routing.
- Assignment origin prevents Captain dispatch from overwriting user-direct
  work.
- Exclusive ownership and dependency preflight block unsafe parallel writes.
- Terminal reports are revisioned, digest-bound, and durable before events.
- A reviewed `Stop` Hook requires terminal evidence and a one-shot Captain
  notification before a Crew can finish normally.
- `PostToolUse(wait_threads)` requires structured zero-time task snapshots and
  persists each Crew cursor; echoed IDs or error prose cannot satisfy coverage.
- A targeted `PreToolUse` gate blocks common mutating paths until Turn-entry is
  complete and invalidates an early Pre-final after later mutations.
- The same gate permanently rejects direct project edits, interactive terminal
  writes, and general shell commands from the Captain; only coordination and a
  shell-control-free Coordlane operator invocation are allowlisted.
- A bundled local operator derives Git preflight evidence and atomically
  produces terminal report/event state without ad-hoc agent scripts.
- An executable finalizer refuses an answer when the current turn lacks a fresh
  registry-wide Pre-final sweep or terminal results remain unread.
- Validator evidence reviewed by the Captain is separate from worker-reported tests.
- Explicit branch policy prevents cherry-pick and persistent-workstream history
  from being mixed.
- Integration records worker and integrated commits; completion never implies
  release, deployment, or Mission completion.

## Architecture

Coordlane uses a non-blocking **Captain** as the user-facing coordinating brain
and **Crew** as bounded execution tasks. A **Validator** produces independent
evidence and a single-writer **Dock Crew** executes authorized integration. The
**Chart** tracks Workstreams and dependencies; the **Logbook** stores structured evidence; **Dock** is controlled integration;
**Launch** is an explicitly authorized migration, deployment, or release.
**Radio** is only an optional transport hint.

Read the [architecture](docs/architecture.md),
[state machines](core/state-machines.md),
[event protocol](core/events.md),
[ownership rules](core/ownership.md), and
[branch policy](core/branch-policy.md).

## Current runnable surface

- one installable Codex plugin with a bundled [`coordlane` Skill](skills/coordlane/SKILL.md);
- reviewed `PreToolUse`, `Stop`, and `PostToolUse` lifecycle [Hooks](hooks/hooks.json);
- Captain, Crew, report, and project-map [`templates/`](templates/);
- seven machine-readable [`schemas/`](schemas/);
- a Node.js standard-library [filesystem reference](reference/README.md);
- a supported local state operator at [`bin/coordlane.mjs`](bin/coordlane.mjs);
- a current-host [Codex desktop adapter](adapters/codex/README.md); and
- 15 executable failure scenarios plus adversarial worktree, receipt, identity,
  quota, and concurrent-writer regression checks.

Coordlane ships no server, daemon, scheduled heartbeat, telemetry, transcript
store, secret handler, automatic merge, deployment, migration, release, or
runtime switch. Plugin Hooks do not run until the user reviews and trusts their
exact definitions.

Turn scans provide active-turn consistency. Sleeping liveness uses a one-shot
Crew notification after its durable event exists. If delivery fails, the event
remains pending and the next Captain turn recovers it; Coordlane does not spend
quota on recurring polling or describe degraded delivery as real-time.

Snapshot cost is bounded per turn. No active assignment means zero task-snapshot
calls. With active Crew, Coordlane tries one batched `timeoutMs=0` snapshot and
only asks for missing targets individually; unchanged results stay silent and
full reports are not reread.

Coordlane does not require per-assignment token, CPU, network, or external-call
quotas. Those are project-specific concerns. The core contract keeps only scope,
ownership, dependencies, validation, and explicit runtime/external-side-effect
authority; quota protection applies to Coordlane's own coordination overhead.

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
node reference/coordlane.mjs init-repo . fictional-library
STATE_DIR="$(node reference/coordlane.mjs state-path .)"
node reference/coordlane.mjs bind-captain "$STATE_DIR" captain-thread local
node reference/coordlane.mjs status "$STATE_DIR"
```

Use `node bin/coordlane.mjs <command> "$STATE_DIR" <payload.json>` for
registration, assignment, verified dispatch, acknowledgement, combined
terminal report/event production, validation, integration recording, release,
and status. See the [operator reference](reference/README.md).

## Codex reliability rules

Current Codex desktop task tools provide stable IDs, listing, reading,
delivery, bounded waiting, cursors, and archival. Coordlane uses Level 2
orchestration with reviewed lifecycle Hooks:

1. dispatch with an `assignment_id`;
2. verify target acknowledgement by reading the task;
3. maintain one cursor per registered, non-archived Crew;
4. let the Hook strictly parse actual non-blocking `wait_threads` snapshots at
   turn entry and pre-final, matching each old cursor before persisting the new
   one; a local event sweep alone cannot pass the finalizer;
5. try one batch for cost control, then scan only targets absent from its result;
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
drain, unchanged suppression, structured final, and archive. Shared worktree
state and concurrent filesystem writers now have local regression coverage;
live Hook trust and tool-response acceptance remain open. See the
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
