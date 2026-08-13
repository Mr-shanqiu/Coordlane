---
name: coordlane-core
description: Dispatch work between existing Codex tasks with linked-worktree isolation, Captain-assigned write paths, explicit durable completion, and one-shot Crew-to-Captain wake messages. Use when a user wants one main Codex task to assign implementation to existing tasks and receive their results without background polling, including when lifecycle Hooks are unavailable.
---

# Coordlane Core

Keep decisions with the Captain. Use Coordlane only for assignment delivery,
workspace isolation, write scopes, durable completion, and result wake-up.

Resolve the plugin root two directories above this file and invoke
`node <plugin-root>/bin/coordlane.mjs`.

## Captain

1. Initialize once with `init <project_id> <captain_thread_id>`.
2. Register each Crew with `worker <project_id> <worker_id> <thread_id>`.
3. Run `health <project_id>` after installation, restart, or task rebinding.
   Treat `hooks.loaded=false` as CLI mode, not as durable automation.
4. At each user turn and after a pure worker-ID wake, run
   `inbox <project_id> [worker_id]` once. It reads only durable, unconsumed
   reports; never loop or poll.
5. Create a clean linked Git worktree for every write assignment.
6. Prepare the assignment with:

   `prepare <project_id> <worker_id> <workspace> <task> <write_path>...`

   Use literal repository-relative paths. End directory scopes with `/`.
7. Send the returned `message` unchanged to the returned Crew thread with
   `send_message_to_thread`. Delivery wakes a sleeping Crew.
8. When `inbox` returns a report, decide validation, integration, or follow-up
   yourself. Present only a curated result to the user.

Do not run a heartbeat or polling loop. A failed wake leaves the report pending
for the next single `inbox` call.

## Crew

Work only in the assigned linked worktree and write only the assigned paths.
Before final, prepare one full report beginning with
`[RESULT][<worker_id>][completed|blocked|decision_needed]`. From inside the
assigned worktree, pass that exact report on stdin to the `complete` command
printed in the Assignment. Use a quoted heredoc when convenient:

```bash
node <plugin-root>/bin/coordlane.mjs complete <project_id> <assignment_id> completed <<'COORDLANE_REPORT'
[RESULT][30][completed]
assignment_id: <assignment_id>
...
COORDLANE_REPORT
```

Only after `complete` succeeds, send the pure worker ID once to the returned
Captain thread, then immediately return the same report without another tool
call. Never retry. If `complete` fails, do not wake the Captain; report the
failure visibly.

`complete` stores the report and releases the assignment's write lock before
the wake. Hooks may automate or record the same lifecycle, but the explicit
commands remain authoritative when Hooks are not observed.
