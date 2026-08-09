# Prior-art and naming review

Last reviewed: 2026-08-09

## Purpose and method

This is a bounded engineering review of public project descriptions, Skill
catalog results, and official product documentation. It exists to avoid false
novelty claims, direct textual borrowing, and confusing positioning. It is not
a comprehensive legal search, patent analysis, or trademark clearance.

No code, prompt text, templates, or protocol sections from the projects below
were copied into this repository. The local draft was authored from the user's
requirements and independently expressed invariants, then compared against
public summaries to narrow its scope.

## Closest adjacent projects

| Project | Material overlap | Distinction maintained here |
| --- | --- | --- |
| [firstmate](https://github.com/kunchenguid/firstmate) | One liaison supervises Crew-like agents, uses isolated worktrees, reconciles results, and reports outcomes. | firstmate is an operational agent distribution with scripts, persistent state, watchers, backends, PR/merge flows, and optional relay. V1 here is a no-daemon, no-runtime, schema-backed protocol that remains usable manually. |
| [AWS Labs CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator) | Built-in supervisor/worker Skills cover assignment, handoff, and idle-based message delivery. | CAO is a server/CLI runtime with provider integration. V1 here ships no server and treats Radio as an optional adapter capability rather than the core. |
| [Nelson](https://github.com/harrymunro/nelson) | Mission planning, parallel assignments, file ownership, checkpoints, quality gates, and a naval coordination metaphor. | Nelson is a Claude Code plugin with detailed Royal Navy terminology, risk tiers, hooks, and operational procedures. V1 here uses a restrained vocabulary, JSON Schemas, multi-platform evidence, and no default hooks. |
| [Orca](https://github.com/stablyai/orca) | Worktree/session handoff, supervised orchestration, task graphs, and status operations. | Orca is a concrete CLI/runtime. V1 here defines portable contracts and does not call or depend on Orca. |
| [agent-team-orchestration Skill](https://github.com/openclaw/skills) | Roles, task lifecycle, handoffs, reviews, and quality gates. | V1 here emphasizes exclusive resource ownership, release distinct from completion, Runtime State authority, JSON validation, and evidence-labeled adapters. |
| [OpenAI Agents SDK handoffs](https://openai.github.io/openai-agents-python/handoffs/) | Specialized agents and handoff semantics. | The SDK builds programmable agent applications. V1 coordinates human-visible work sessions without providing an agent runtime. |

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
3. Describe the actual narrow contribution: a portable, manually operable,
   schema-backed contract separating Workstream completion, ownership release,
   integration, and Launch authority.
4. Cite official host documentation for compatibility claims and date every
   capability matrix.
5. Repeat this review immediately before publication and release notes.

## Publication gate

Status: **working name locally cleared**. Creating or pushing a public
repository still requires user confirmation plus a fresh availability and
appropriate legal/trademark review.
