# Prior-art and naming review

Last reviewed: 2026-08-11

## Purpose and method

This is a bounded engineering review of public project descriptions, Skill
catalog results, and official product documentation. It exists to avoid false
novelty claims, direct textual borrowing, and confusing positioning. It is not
a comprehensive legal search, patent analysis, or trademark clearance.

No code, prompt text, templates, or protocol sections from the projects below
were copied into this repository. The local draft was authored from the user's
requirements and independently expressed invariants, then compared against
public summaries to narrow its scope.

## Current competitive landscape

This is a comparison of product boundaries, not a ranking. Several projects
below are broader, more mature, or more operationally complete than Coordlane.
Coordlane should not claim to replace them.

| Project | Capabilities broader than Coordlane | Coordlane boundary |
| --- | --- | --- |
| [Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) (formerly under ComposioHQ) | A desktop agent IDE with a daemon, live task/session UI, isolated worktrees, many agent adapters, browser preview, pull-request awareness, and automatic CI, review, and merge-conflict feedback loops. | Coordlane does not launch an agent fleet or provide a dashboard, browser, CI loop, or broad runtime adapters. It focuses on reliability gates around existing Codex tasks. |
| [Gas Town](https://github.com/gastownhall/gastown) | A multi-runtime workspace manager with persistent identities, git-backed work state, mailboxes, handoffs, scheduling, escalation, monitoring, and long-running orchestration for much larger fleets. | Coordlane intentionally has no scheduler, daemon, recurring heartbeat, AI patrol, or federated workspace. It trades continuous liveness and scale for a smaller, bounded, quota-conscious Codex plugin. |
| [Superpowers](https://github.com/obra/superpowers) | A mature, multi-harness software-development methodology covering design, planning, worktrees, TDD, subagent-driven implementation, and staged review. | Coordlane is not a development methodology or replacement for Superpowers. It governs identity, ownership, terminal evidence, discovery, validation, and integration across existing Codex tasks; the two can be complementary. |
| [Ruflo](https://github.com/ruvnet/ruflo) | A much larger orchestration platform with large agent catalogs, swarm topologies, memory, RAG, federation, multi-provider routing, background workers, MCP tools, and plugins. | Coordlane provides none of those breadth features. It keeps a narrow local state model and avoids background workers or recurring AI activity. |
| [Warren](https://github.com/jayminwest/warren) | A self-hostable control plane that creates isolated sandboxes, streams run events to a UI, supports steering, and automates GitHub issue-to-run-to-branch/PR workflows. | Coordlane ships no server, container control plane, secret handling, sandbox runtime, autonomous issue polling, or PR automation. It remains inside the Codex task lifecycle. |

### Lifecycle signals

- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) demonstrates a much
  richer task board, agent-workspace, diff-review, preview, and pull-request UI,
  but its official
  [v0.1.42 release](https://github.com/BloopAI/vibe-kanban/releases/tag/v0.1.42-20260410131124)
  announced that the company behind it was shutting down, and the project is
  now described as sunsetting. It is kept as interface prior art rather than an
  active durability benchmark.
- [Overstory](https://github.com/jayminwest/overstory) implemented a broad
  coordinator, worktree, mail, merge-queue, observability, and watchdog system,
  but its repository was archived on 2026-05-28. Its ecosystem now presents
  Warren as the headline control plane, so Overstory is treated as historical
  prior art.

## Closest adjacent projects

| Project | Material overlap | Distinction maintained here |
| --- | --- | --- |
| [firstmate](https://github.com/kunchenguid/firstmate) | One liaison supervises Crew-like agents, uses isolated worktrees, reconciles results, and reports outcomes. | firstmate is an operational agent distribution with watchers, backends, PR/merge flows, and optional relay. Coordlane targets existing Codex tasks and does not run a watcher or agent backend. |
| [AWS Labs CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator) | Built-in supervisor/worker Skills cover assignment, handoff, and idle-based message delivery. | CAO is a server/CLI runtime with provider integration. Coordlane ships no server and treats Radio as an optional hint rather than report truth. |
| [Nelson](https://github.com/Aspegio/nelson) | Mission planning, parallel assignments, file ownership, checkpoints, quality gates, and a naval coordination metaphor. | Nelson is a Claude Code plugin with detailed Royal Navy terminology, risk tiers, hooks, and operational procedures. Coordlane currently targets Codex, uses restrained vocabulary, and centers durable evidence plus executable finalization gates. |
| [Orca](https://github.com/stablyai/orca) | Worktree/session handoff, supervised orchestration, task graphs, and status operations. | Orca is a concrete CLI/runtime. Coordlane does not launch an agent runtime and does not call or depend on Orca. |
| [OpenAI Agents SDK handoffs](https://openai.github.io/openai-agents-python/handoffs/) | Specialized agents and handoff semantics. | The SDK builds programmable agent applications. Coordlane coordinates human-visible Codex tasks without providing an agent runtime. |

## Coordlane's narrow contribution

Coordlane does not claim invention of supervisors, workers, worktrees, task
graphs, handoffs, mailboxes, lifecycle hooks, durable state, or review gates.
Its current contribution is a small Codex-native reliability layer that combines:

1. a non-blocking Captain that performs no project execution;
2. stable task binding plus identity-bound Assignment acknowledgement;
3. exclusive ownership and dependency preflight before work starts;
4. durable, revisioned, digest-bound reports and terminal events;
5. one-shot Hook notification backed by Turn-entry and Pre-final full sweeps;
6. quiet, curated user output rather than raw worker reports;
7. independent Validator evidence and a single-writer Dock boundary; and
8. bounded incremental discovery without heartbeat, daemon, or retry polling.

No individual item is novel. The product position is this conservative
combination for existing Codex tasks, especially where keeping the user-facing
task responsive and avoiding recurring quota consumption matters.

## Rejected name candidates

`Agent Captain` was rejected after finding an existing public
`agent-captain` repository and several materially adjacent Captain/Crew
orchestration projects.

`agent-CEO` / `agent-ceo` was rejected after a GitHub repository-name search
returned 35 results. Material examples include:

- [fortydaemon/agent-ceo](https://github.com/fortydaemon/agent-ceo): an MIT
  operating framework with governance, reporting, delegation, memory, and
  multi-agent safety guidance;
- [Nosko666/agent-ceo](https://github.com/Nosko666/agent-ceo): an MIT terminal
  multi-agent chatroom orchestrator supporting multiple coding agents; and
- [qiuyiwu1989-star/AgentCEO](https://github.com/qiuyiwu1989-star/AgentCEO): an
  AI-agent management kernel covering organization, task governance, decisions,
  and risk escalation.

This is a high-confusion result. Case changes do not create a meaningful
distinction on GitHub or in ordinary search.

## Selected working name

The selected working name is **Coordlane**, with the repository, package, and
Skill slug `coordlane`. On 2026-08-09:

- exact GitHub repository-name search returned zero results;
- the npm registry returned `404` for the exact package name;
- PyPI returned `404` for the exact project name; and
- exact web, skills.sh, and GitHub `SKILL.md` searches returned no results.

The name evokes separate coordination lanes for scoped Workstreams. These
checks reduce obvious collision risk but do not constitute trademark clearance
or reserve any name.

## Independent design rules

1. Do not claim invention of supervisor/worker roles, worktrees, handoffs,
   dependency graphs, checkpoints, quality gates, or idle notifications.
2. Do not copy project-specific vocabulary systems, step sequences, templates,
   prose, scripts, or implementation details.
3. Describe the actual narrow contribution: a Codex-native, schema-backed
   reliability layer separating dispatch, acknowledgement, Workstream
   completion, validation, ownership release, integration, and Launch authority.
4. Cite official host documentation for compatibility claims and date every
   capability matrix.
5. Repeat this review immediately before publication and release notes.

## Current limitations

Coordlane has no dedicated UI, multi-host fleet runtime, broad adapter catalog,
autonomous CI/PR loop, scheduler, background recovery service, or continuous
sleeping-controller liveness. If a one-shot terminal notification fails after
the Captain's final response, the durable event is recovered only on the next
Captain turn. Repository tests cover the protocol and Hook logic, but live host
trust and tool-response acceptance remain explicit acceptance boundaries.

These limits are part of the positioning, not temporary claims of parity with
the broader systems above.

## Release positioning gate

Status: **working name locally cleared**. The availability evidence above is
dated and does not constitute trademark clearance. Refresh project status,
links, naming availability, and capability claims before a marketplace release
or other material publication.
