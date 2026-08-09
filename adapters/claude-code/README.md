# Claude Code adapter

## Classification

- Skills and subagents: **Native**.
- Agent Teams: **Native, experimental, disabled by default**.
- Terminal lifecycle capture: **Hook-assisted**.
- Conditional Radio exactly as defined by the core: **disabled until a fresh,
  non-interrupting idle check and one-shot delivery are verified**.

## Recommended mapping

Use subagents for focused tasks that report to the caller. Use Agent Teams only
when independent sessions genuinely need shared tasks or direct messaging and
the user accepts the experimental feature and additional token cost. Use
separate Git worktrees for concurrent writers; Agent Teams do not isolate files
for you.

`SubagentStop`, `TeammateIdle`, and `TaskCompleted` hooks can help validate or
capture terminal state, but hooks are executable code. Keep them opt-in, review
their source, bound their runtime, and provide a no-hook manual path.

Claude Agent Teams deliver teammate messages automatically and expose idle
notifications, so the core's pure-ID Radio is usually unnecessary. Prefer the
native lead summary and Captain checkpoint review over an extra notification
layer.

The lead must still execute the core dual turn gate. Use a non-blocking team
task/status snapshot at turn entry and pre-final when the installed version
exposes one. Persist and compare the smallest available task revision or state
marker. If the surface cannot prove an incremental non-blocking read, label the
gate Manual and perform an explicit changed-report check; hooks do not replace
the two scans.

## Known limits affecting the protocol

- Agent Teams are experimental and disabled by default.
- A team has one fixed lead and no nested teams.
- In-process teammate sessions are not restored by resume/rewind.
- Task state can lag actual completion.
- Teammates share the project checkout unless you partition paths or use
  separate worktree sessions.

## Official evidence

- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Run agents in parallel](https://code.claude.com/docs/en/agents)
- [Custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Hooks reference](https://code.claude.com/docs/en/hooks)
