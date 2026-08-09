# Coordlane

> One coordinating brain for organized multi-agent project work.

[简体中文](README.zh-CN.md)

Coordlane is a protocol-first, cross-platform coordination kit for people
using multiple AI coding or work sessions on one complex mission. It defines
how a Captain assigns bounded work to Crew sessions, records ownership and
dependencies, reviews evidence, releases files, and controls integration or
external side effects.

This repository is an early local-first draft. It does not run a server,
monitor conversations, store chat data, merge code, or deploy anything.

## Why it exists

Parallel AI sessions make execution faster, but they also introduce familiar
coordination failures: duplicate edits, unclear responsibility, hidden
dependencies, noisy handoffs, premature declarations of completion, and work
that was never tested, committed, or safely released.

Coordlane treats coordination as an explicit project contract instead of
an informal stream of chat messages.

## The model

- **Mission** — the final outcome and acceptance boundary.
- **Captain** — the single coordination authority and user-facing interface.
- **Crew** — bounded specialist sessions that execute one Workstream.
- **Chart** — the dependency graph and route to completion.
- **Logbook** — structured reports and recorded evidence.
- **Radio** — optional low-interruption terminal notifications.
- **Checkpoint** — a verified safe stopping point.
- **Dock** — controlled integration after ownership is released.
- **Launch** — an explicitly authorized migration, deployment, or release.

The normative rules live in [`core/`](core/). Platform behavior belongs only
in [`adapters/`](adapters/), and machine-readable records live in
[`schemas/`](schemas/).

## V1 scope

V1 provides:

- a portable `coordlane` Skill;
- Captain and Crew prompt templates;
- ownership, dependency, report, handoff, and release-gate protocols;
- JSON Schemas for workstreams, ownership, and terminal reports;
- evidence-labeled adapters for Codex, Claude Code, CodeBuddy, WorkBuddy, and
  generic prompt-only environments;
- a fictional, data-free example; and
- local validation for the Skill and schemas.

V1 deliberately provides no daemon, cloud account, telemetry, transcript
storage, secret handling, automatic merge, automatic deployment, or trusted-by-
default third-party hook.

## Quick start

1. Clone or download the repository when you want the complete protocol,
   schemas, adapters, and templates. For a compact standalone install, copy
   `skills/coordlane/` into a Skill directory supported by your host.
2. Start with [`templates/captain-prompt.md`](templates/captain-prompt.md) in
   the coordinating session.
3. Define workstreams with
   [`templates/project-map.md`](templates/project-map.md).
4. Give each Crew session a completed copy of
   [`templates/crew-prompt.md`](templates/crew-prompt.md).
5. Require terminal reports in the format from
   [`templates/report.md`](templates/report.md).
6. Use the relevant adapter only when its capability and verification notes
   match the current host.

Run local checks:

```sh
npm install
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/coordlane
```

The last command intentionally points to the host's official Skill validator;
its location varies by installation.

## Capability levels

| Level | Meaning |
| --- | --- |
| Native | The host exposes verified primitives for the operation. |
| Hook-assisted | A reviewed, opt-in lifecycle hook can implement it. |
| Polling | The Captain reads durable state at mandatory turn gates or other bounded checkpoints. |
| Manual | People copy prompts or reports between sessions. |

See the dated [capability matrix](docs/research/capability-matrix.md). An
adapter must state its evidence, limitations, and fallback. Unknown is never
promoted to Native.

## Safety rules

- Captain alone authorizes integration, migration, deployment, release, and
  runtime switches.
- A Crew owns only its assigned paths and resources.
- Shared entry points have a single writer; Crew sessions submit change lists
  for Captain integration.
- `completed` means the assigned workstream is complete, not the Mission.
- Completion does not release files. Release requires a commit disposition,
  workspace check, validation evidence, a no-more-edits promise, overlap
  review, and external-side-effect disclosure.
- Every Captain turn has two completeness gates: a non-blocking incremental
  scan of registered, non-archived Crew at turn entry and again before the
  final response. Crew notifications never replace these scans.
- Radio is optional. It never retries or creates a background watcher in V1.

## Prior art and independent scope

Multi-agent orchestration is an established field. Several existing projects
overlap with parts of this idea, including `firstmate`, AWS Labs CLI Agent
Orchestrator, Nelson, Orca, and general team-orchestration Skills. We reviewed
their public positioning to avoid claiming novelty and to define a narrower
scope. No source code or prose from those projects is included here.

See the [prior-art review](docs/research/prior-art.md) for similarities,
differences, links, and the pre-publication naming gate. This is an engineering
comparison, not legal advice or a trademark clearance.

## Project status

Phase 1 is a reviewable public draft at
[`Mr-shanqiu/Coordlane`](https://github.com/Mr-shanqiu/Coordlane). A tagged
release remains gated on:

1. user review of the protocol and adapters;
2. a fresh availability and trademark review for `Coordlane`;
3. a fresh official-document and prior-art check; and
4. validation of installation and triggering in each claimed host.

The proposed follow-up work is in the [Phase 2 plan](docs/phase-2-plan.md).

## License

[MIT](LICENSE)
