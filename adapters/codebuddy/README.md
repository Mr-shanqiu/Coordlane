# CodeBuddy adapter

> Deferred research note. This adapter is not active, implemented, or tested in
> the current Codex-only phase. Do not claim compatibility from this file.

## Classification

- Skills and subagents: **Native**.
- Agent Teams and their mailbox/task system: **Native, experimental**.
- Dynamic Workflows: **Native, research preview**.
- Terminal lifecycle capture: **Hook-assisted, beta**.
- Exact core Radio: **Hook-assisted only after explicit review; otherwise
  disabled**.

## Recommended mapping

Use Agent Teams when the leader needs shared tasks, dependencies, member
status, and direct messaging. Use subagents for focused work. Use Dynamic
Workflows only when a readable orchestration script is itself required and the
research-preview boundary is acceptable.

CodeBuddy documents lifecycle events including `SubagentStop`, `TaskCompleted`,
and `TeammateIdle`. A reviewed hook can write a terminal report or enforce a
gate, but V1 does not ship or enable such a hook. Non-built-in Skill hooks may
require an explicit trust setting, which is intentionally not part of the
default installation.

The leader must run the core turn-entry and pre-final scans independently of
those events. Use the installed version's non-blocking team status snapshot and
stored task revision when verified. Otherwise downgrade the gate to an explicit
Manual changed-report check. A lifecycle hook is only a fast path.

## Known limits affecting the protocol

- Agent Teams are experimental, have no member session recovery, and can show
  lagging task state.
- Members do not create nested teams; the lead remains fixed.
- Dynamic Workflows are a research preview and version-dependent.
- Hooks are beta and may evolve; untrusted frontmatter hooks are skipped unless
  the user changes a security setting.
- Native team state does not replace file ownership; concurrent edits still
  require disjoint paths or worktrees.

## Official evidence

- [CodeBuddy Agent Teams](https://www.codebuddy.ai/docs/cli/agent-teams)
- [CodeBuddy sub-agents](https://www.codebuddy.ai/docs/cli/sub-agents)
- [CodeBuddy Skills](https://www.codebuddy.ai/docs/cli/skills)
- [CodeBuddy hooks](https://www.codebuddy.ai/docs/cli/hooks)
- [CodeBuddy Dynamic Workflows](https://www.codebuddy.ai/docs/cli/workflows)
