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
| `observe_attention` | `PermissionRequest` Hook plus `needs_attention` snapshots | Persist a redacted nonterminal request; retain native approval UI |
| `persist_report` | Worker final task record and, when configured, the shared Coordlane report store | Terminal state must be complete before consumption |
| `emit_event` | Local digest-bound event after a durable report | Required before the Crew can stop |
| `deliver_notification` | `send_message_to_thread` once with the pure `worker_id` | Transport hint; never report truth |
| `enforce_terminal_gate` | Plugin `Stop` Hook | Refuses a normal stop until report/event and delivery evidence exist |
| `record_delivery_receipt` | Plugin `PostToolUse` for `send_message_to_thread` | Requires a matching Captain target, pure worker ID, and structured transport receipt |
| `scan_events` | per-task `wait_threads(timeoutMs=0, afterCursor)` or changed `read_thread` snapshot | Iterate every registered task and retain each cursor |
| `ack_event` | Captain consumption ledger | Only after digest/identity verification and report consumption |
| `archive_worker` | `set_thread_archived` after assignment close and event drain | Never archive active work |
| `workspace_status` | local Git read-only checks in the registered workspace/worktree | Recheck HEAD and dirty state |
| `integrate_change` | Dock Crew Git operation after identity-bound Captain authorization | Captain records the validated result; never automatic |

State-changing operations use the bundled `bin/coordlane.mjs` operator. Its
verified dispatch reads Git cleanliness and branch itself; its acknowledgement
command evaluates a supplied current task snapshot; and its terminal command
persists the report plus event in one locked producer operation.

The local store schema is `1.2.0`. Opening a `1.0.0` or `1.1.0` store from Coordlane
0.3.2 runs the bundled locked compatibility migration before status, sweep, or
mutation. Only that project-led migration may consume legacy records. Normal
reads validate all state record families, so a mixed, missing, unknown, or
future child version fails closed before status, sweep, or Hook processing.

## Captain availability invariant

The bound Captain task is a non-blocking control plane. `PreToolUse` denies
direct file edits, interactive terminal writes, and general `Bash` or
`exec_command` use even after Turn-entry passes. It allowlists task coordination
and one shell-control-free invocation of the exact real paths of the current
Node executable and bundled `bin/coordlane.mjs`. Copied scripts and Node
wrappers are rejected. The operator may
record reviewed validation and integration evidence, but the Captain cannot run
the underlying tests or Git integration.

Implementation, evidence-producing validation, and integration execution run
in bounded Crew tasks. A Dock Assignment must identify the Captain decision,
exact source commit, target branch, allowed strategy, forbidden operations, and
stop conditions. The Captain dispatches and yields instead of waiting for a
worker inside the user turn.

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
   effects, and authority.
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

1. snapshot registered, non-archived tasks with active assignments; an idle
   registry completes both gates without task-tool calls;
2. recover any durable report without an event;
3. call one batched non-blocking snapshot first, then query only targets absent
   from that response with their own cursors; coverage requires an exact
   structured task object, boolean `changed`, and returned cursor matching the
   stored old cursor;
4. if changed, read only the new terminal turn/report and validate its stable
   assignment identity;
5. repeat that task until no unconsumed revision remains through the sweep's
   high-water boundary;
6. persist the new cursor only after successful consumption; and
7. stay silent when the entire sweep is unchanged.

The `PostToolUse(wait_threads)` Hook strictly parses which stable task addresses
were actually present in each snapshot result for the active `turn_id` and
persists their new cursors. An echoed task ID or error prose is not coverage. Both entry
and pre-final coverage are required; draining only local mailbox files cannot
pass the finalizer. A per-turn call limit prevents polling loops.

The `PreToolUse` Hook first enforces the Captain availability allowlist, then
requires entry coverage for permitted control-plane actions. A covered operator
mutation after an early Pre-final invalidates that phase so it cannot be reused
at finalization.

## Approval attention

Coordlane 0.3.4 observes `PermissionRequest` without returning allow or deny.
The native Codex approval remains visible in the Crew task. The Hook stores no
raw command or tool arguments: only stable identity, active Assignment,
redacted reason, tool kind, and a digest. A pending request remains orthogonal
to the `running` Assignment, appears in `pending_attention_count`, and must be
surfaced once during the active Captain turn before finalization.

This is not a cross-task approve button. There is no model auto-review,
heartbeat, retry loop, or hidden denial. If state routing is missing, Coordlane
leaves native approval behavior unchanged. Exact single-use preauthorization
is deferred until a separately reviewed authority model exists.

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
4. let `PostToolUse` record a structured transport-issued delivery receipt; and
5. let `Stop` verify the evidence before final output.

If the Crew omitted a step, `Stop` creates one continuation prompt. The first
send is the only attempt; an unconfirmed response records
`delivery_degraded_at` and permits the Crew to stop
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

For Git projects, initialize state once with `init-repo`. The store lives under
the Git common directory, so linked worktrees share it without copying an
ignored workspace folder. The filesystem and CLI remain a same-user trust
boundary, not protection against a hostile process running as that user. Hook
role checks prevent a registered Crew from accidentally invoking Captain-only
operator actions, but they are not cryptographic authorization. Multi-file
JSON transitions use a store lock and atomic files, but they are not a
crash-atomic database transaction.

## Evidence

- [OpenAI: Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI: Package plugins](https://developers.openai.com/plugins/build/plugins)
- Current Codex desktop tool inventory observed 2026-08-09; this is runtime
  evidence, not a public cross-surface API contract.
