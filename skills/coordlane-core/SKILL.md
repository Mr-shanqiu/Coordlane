---
name: coordlane-core
description: Dispatch work between existing Codex tasks with linked-worktree isolation, Captain-assigned write paths, durable terminal results, and one-shot Crew-to-Captain wake messages. Use when a user wants one main Codex task to assign implementation to one or more existing tasks and receive their results without polling.
---

# Coordlane Core

Keep decisions with the Captain. Use Coordlane only for assignment delivery,
workspace isolation, write scopes, and result wake-up.

Resolve the plugin root two directories above this file and invoke
`node <plugin-root>/bin/coordlane.mjs`.

## Captain

1. Initialize once with `init <project_id> <captain_thread_id>`.
2. Register each Crew with `worker <project_id> <worker_id> <thread_id>`.
3. Create a clean linked Git worktree for every write assignment.
4. Prepare the assignment with:

   `prepare <project_id> <worker_id> <workspace> <task> <write_path>...`

   Use literal repository-relative paths. End directory scopes with `/`.
5. Send the returned `message` unchanged to the returned Crew thread with
   `send_message_to_thread`. Delivery wakes a sleeping Crew.
6. When a Crew sends its pure worker ID, use the durable report injected by
   the plugin. Decide validation, integration, or follow-up yourself.

Do not run a heartbeat or polling loop. An undelivered terminal report is
injected on the Captain's next user turn.

## Crew

Work only in the assigned linked worktree and write only the assigned paths.
Return one clear final result. On the first Stop, Coordlane saves that result
and asks for one pure worker-ID message to the Captain. Send it once, then
immediately return the same final result without another tool call. Never retry.

Coordlane's second Stop always permits exit, even if notification failed.
