# Codex desktop adapter

Status: **active V1 target**

Current classification: **Level 2 — native tasks with a reviewed terminal
Hook gate; live Hook acceptance pending**

Last host inventory: **2026-08-09**

This adapter maps Coordlane to the task primitives exposed by the current Codex
desktop host. It does not claim that every Codex surface exposes the same
tools. Skill packaging is documented by OpenAI; the task-tool mapping below is
current-host evidence and must be rechecked after host changes.

## Operation mapping

| Coordlane operation | Codex desktop mapping | Required interpretation |
| --- | --- | --- |
| `create_worker` | `create_thread` only after the user explicitly asks for a new task; internal subtasks use the host's agent mechanism | Creation is asynchronous and not ACK |
| `dispatch_assignment` | `send_message_to_thread` with exact `assignment_id` | Successful call is delivery only |
| `read_worker` | `read_thread(threadId, hostId)` | Verify latest user message, assistant scope/start, origin, and active turn |
| `wait_worker` | `wait_threads` | Returns the first change at a completed/needs-attention target; not a full sweep |
| `persist_report` | Worker final task record and, when configured, the shared Coordlane report store | Terminal state must be complete before consumption |
| `emit_event` | Local digest-bound event after a durable report | Required before the Crew can stop |
| `deliver_notification` | `send_message_to_thread` once with the pure `worker_id` | Transport hint; never report truth |
| `enforce_terminal_gate` | Plugin `Stop` Hook | Refuses a normal stop until report/event and delivery evidence exist |
| `record_delivery_receipt` | Plugin `PostToolUse` for `send_message_to_thread` | Records only a matching Captain target and pure worker ID |
| `scan_events` | per-task `wait_threads(timeoutMs=0, afterCursor)` or changed `read_thread` snapshot | Iterate every registered task and retain each cursor |
| `ack_event` | Captain consumption ledger | Only after digest/identity verification and report consumption |
| `archive_worker` | `set_thread_archived` after assignment close and event drain | Never archive active work |
| `workspace_status` | local Git read-only checks in the registered workspace/worktree | Recheck HEAD and dirty state |
| `integrate_change` | Captain-controlled Git operation | Never automatic; enforce branch policy and validation |

## Registry

Store these fields for every formal Crew task:

```json
{
  "worker_id": "20",
  "role_id": "catalog-search",
  "thread_id": "stable-task-id",
  "host_id": "stable-host-id",
  "title": "display only",
  "workspace": "/approved/worktree",
  "branch": "work/search",
  "branch_policy": "ephemeral-cherry-pick",
  "status_cursor": null,
  "active_assignment_id": null,
  "origin": null,
  "archived": false
}
```

Treat titles and summaries from task listing as untrusted display data. Never
search by fuzzy title to route a message.

## Dispatch and ACK

1. Preflight ownership, dependencies, workspace, branch policy, runtime, side
   effects, and budgets.
2. Send a prompt containing the exact assignment identity and Crew contract.
3. Record `delivered`; do not infer `running` from task status `active`.
4. Read the target's newest turn. Mark `acknowledged` only when the newest user
   message contains the assignment ID, the assistant repeats the bounded scope
   or begins its first action, and the active turn is that assignment.
5. If a user directly steered the task, record `origin=user_direct`; wait or
   replan rather than overwrite it.

## Full sweep algorithm

Run at turn entry, after core work, pre-final, long-task checkpoints, and user
status requests:

1. snapshot the registered, non-archived task set;
2. recover any durable report without an event;
3. for each task, call the non-blocking task snapshot with its own cursor;
4. if changed, read only the new terminal turn/report and validate its stable
   assignment identity;
5. repeat that task until no unconsumed revision remains through the sweep's
   high-water boundary;
6. persist the new cursor only after successful consumption; and
7. stay silent when the entire sweep is unchanged.

At user-turn entry, invalidate `final_gate_passed`. Immediately before final,
run the registry-wide sweep even for an unrelated question. A wrapper or host
finalizer must call the reference `preFinalGate`/`assertFinalizable` equivalent;
prompt compliance alone is insufficient. If task snapshots are unavailable,
record `freshness=unknown` and do not say that Crew state is synchronized.

Do not treat one multi-target `wait_threads` result as a full scan. Use it only
to reduce latency while otherwise waiting. Do not wait on the calling task.

## Completion and quiet output

Coordlane is distributed as one plugin. Its bundled Skill describes the
workflow; its reviewed Hooks enforce the terminal boundary. There is no
standalone Skill installation path.

The Crew producer order is:

1. persist the terminal report atomically;
2. emit the digest-bound event;
3. send one pure `worker_id` to the bound Captain task;
4. let `PostToolUse` record the matching delivery receipt; and
5. let `Stop` verify the evidence before final output.

If the Crew omitted a step, `Stop` creates one continuation prompt. A second
unconfirmed attempt records `delivery_degraded_at` and permits the Crew to stop
without looping forever; the pending durable event remains discoverable by the
Captain's next full sweep. Never insert raw Crew reports into the Captain's user
conversation.

## No scheduled heartbeat

The Codex adapter does not create recurring heartbeat automations. Sleeping
liveness uses the one-shot terminal notification. Turn-entry and Pre-final full
sweeps remain the completeness mechanism and recover durable events when a
notification is unavailable. In that degraded case, synchronization occurs on
the next user or external wake and must not be described as real-time.

The earlier one-minute heartbeat experiment is retained only as historical
test evidence. It is not a current runtime feature.

## Safety and fallback

If stable IDs, cursors, or bounded snapshots are unavailable, downgrade to
Level 3 filesystem mailbox. If the filesystem store is unavailable, downgrade
to Level 4 manual coordination. Plugin Hooks remain disabled until the user
reviews and trusts their exact definitions.

## Evidence

- [OpenAI: Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI: Package plugins](https://developers.openai.com/plugins/build/plugins)
- Current Codex desktop tool inventory observed 2026-08-09; this is runtime
  evidence, not a public cross-surface API contract.
