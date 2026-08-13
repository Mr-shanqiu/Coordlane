---
name: coordlane-core
description: Dispatch work between existing Codex tasks with linked-worktree isolation, Captain-assigned write paths, preflight approval routing, explicit durable completion, and one-shot Crew-to-Captain wake messages. Use when a user wants one main Codex task to assign implementation to existing tasks, decide approval-sensitive operations before they reach a host dialog, and receive results without background polling.
---

# Coordlane Core

Keep decisions with the Captain. Use Coordlane only for assignment delivery,
workspace isolation, write scopes, preflight approval routing, durable
completion, and result wake-up.

Resolve the plugin root two directories above this file and invoke
`node <plugin-root>/bin/coordlane.mjs`.

## Captain

1. Initialize once with `init <project_id> <captain_thread_id>`.
2. Register each Crew with `worker <project_id> <worker_id> <thread_id>`.
3. Run `health <project_id>` after installation, restart, or task rebinding.
   Treat `hooks.loaded=false` as CLI mode, not as durable automation.
4. At each user turn and after a pure worker-ID wake, run
   `inbox <project_id> [worker_id]` once. It reads durable terminal reports and
   unresolved approval requests; never loop or poll. Approval requests remain
   visible until explicitly decided.
5. Create a clean linked Git worktree for every write assignment.
6. Prepare the assignment with:

   `prepare <project_id> <worker_id> <workspace> <task> <write_path>...`

   Use literal repository-relative paths. End directory scopes with `/`.
7. Send the returned `message` unchanged to the returned Crew thread with
   `send_message_to_thread`. Delivery wakes a sleeping Crew.
8. When `inbox` returns an approval request, decide it before ending the turn:

   `decide-approval <project_id> <approval_id> <approve|reject> <note>`

   Send the returned `resume.message` unchanged to its Crew thread. The
   decision remains visible in later normal `inbox` reads until Crew receives
   it and runs the included `ack-approval` command (the Hook records this
   automatically when it sees the unchanged message). Approve only when the
   exact operation is within existing user authority. Ask the user in the
   Captain task when authority is missing. Captain approval is a policy
   decision and never bypasses a final Codex host approval.
9. When `inbox` returns a report, decide validation, integration, or follow-up
   yourself. Present only a curated result to the user.

Do not run a heartbeat or polling loop. A failed wake leaves the report pending
for the next single `inbox` call.

## Crew

Work only in the assigned linked worktree and write only the assigned paths.

Before invoking an operation likely to open a Codex approval dialog, do not
invoke it. Pass a JSON request to the exact `request-approval` command printed
in the Assignment:

```json
{
  "action": "delete_temporary_directory",
  "target": "/private/tmp/example",
  "reason": "Cleanup after validation",
  "required_for_completion": false,
  "destructive": true,
  "fallback": "Leave it for operating-system cleanup",
  "command": "rm -rf /private/tmp/example"
}
```

After `request-approval` succeeds, send the pure worker ID once to the Captain
thread and end the current turn without calling `complete`. This is a pause,
not a terminal result. Resume only from an unchanged
`[COORDLANE][APPROVAL_DECISION]` message and run its `ack-approval` command
before continuing. If rejected, skip optional work or
report a real blocker for required work. If approved, run only the exact
recorded command; Codex may still require final user approval. Never put a
secret, credential, token, or private value in an approval request.

For terminal completion, prepare one full report beginning with
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
the wake. When loaded, the PreToolUse Hook intercepts recognized deletion,
destructive Git, and prune commands before a host approval dialog unless an
exact one-use Captain approval exists. Hooks may automate or record the same
lifecycle, but the explicit commands remain authoritative when Hooks are not
observed.
