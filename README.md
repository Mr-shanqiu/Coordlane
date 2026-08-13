# Coordlane Core

Dispatch isolated Codex tasks and wake the Captain when a Crew result is ready.

Coordlane Core intentionally does only four things:

1. register one Captain and existing Crew task IDs;
2. dispatch an assignment to a sleeping Crew;
3. require a clean linked Git worktree and Captain-owned write paths; and
4. persist the Crew's final result before allowing one wake message back to the Captain.

Everything after delivery is the Captain's decision. Coordlane does not test,
review, merge, deploy, schedule heartbeats, or run background polling.

[完整中文说明](README.zh-CN.md)

## Why a plugin

A prompt can suggest a workflow but cannot reliably enforce timing. Coordlane's
authoritative path is therefore explicit: `complete` durably stores the final
report before a wake, and `inbox` reads it once at the Captain. Codex lifecycle
Hooks add automation and diagnostics when the host actually loads them; the
core workflow remains usable when they are absent.

## Lifecycle

```text
Captain prepares assignment
  -> send_message_to_thread wakes Crew
  -> Crew works in its linked worktree
  -> Crew runs complete with the final report on stdin
  -> report becomes durable and the write lock is released
  -> Crew sends its worker ID once
  -> send_message_to_thread wakes Captain
  -> Captain runs inbox once and decides the next action
```

If the wake fails, the durable report remains pending for the Captain's next
single `inbox` call. No retry, timer, daemon, background poll, or model
heartbeat is used.

## Workspace boundary

Each write assignment records:

- exact linked-worktree path;
- branch and baseline HEAD captured at assignment time; and
- literal repository-relative files or directory prefixes the Crew may write.

Coordlane rejects overlapping active write scopes, blocks known edit tools
before an out-of-scope write, and checks committed, staged, unstaged, and
untracked paths at terminal capture. Hooks are guardrails rather than an
operating-system security boundary; the linked worktree limits collision impact.

## Local data

Runtime data stays in `~/.codex/coordlane-core/` and is never part of this Git
repository. It contains registries, assignments, terminal reports, delivery
markers, and a rotating sanitized `logs/coordlane.jsonl`. No telemetry is sent.

## Operator

```bash
node bin/coordlane.mjs init demo <captain-thread-id>
node bin/coordlane.mjs worker demo 30 <crew-thread-id>
node bin/coordlane.mjs prepare demo 30 /absolute/worktree "Implement the task" src/ tests/example.test.js
node bin/coordlane.mjs complete demo <assignment-id> completed < report.txt
node bin/coordlane.mjs inbox demo 30
node bin/coordlane.mjs health demo
node bin/coordlane.mjs status demo
```

Send the `message` returned by `prepare` unchanged with Codex's native
`send_message_to_thread` tool.

`health` reports Hook bundle/configuration state separately from observed Hook
execution. Only `hooks.loaded=true` proves that every registered task has fired
a Hook. Otherwise Coordlane returns `mode=cli_required`; use `complete` and
`inbox` and do not claim automatic lifecycle coverage.

## Trust and testing

Codex requires users to review and trust changed plugin Hooks. After installing
or updating Coordlane, fully restart Codex so the host reloads the Hook bundle.
Then use a new task, trust the Hooks, and run a disposable Captain/Crew wake
test before relying on Hook automation. Seeing the Skill in a task does not by
itself prove that the lifecycle Hooks were loaded. Explicit `complete` and
`inbox` remain the reliable fallback.

```bash
npm test
python3 /Users/yue/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/coordlane-core
python3 /Users/yue/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

MIT licensed.
