# Codex capability matrix

Last reviewed: 2026-08-09

The current implementation phase tests only Codex desktop. Other platform
research is intentionally excluded from compatibility claims until Codex
acceptance is complete.

| Coordlane capability | Current Codex desktop evidence | V1 classification |
| --- | --- | --- |
| Plugin with bundled Skill | Standard manifest plus internal Skill | Locally validated packaging |
| Reviewed lifecycle Hooks | `Stop` and `PostToolUse` are documented Codex events | Implemented; live trust acceptance pending |
| Stable task identity | Task listing returns task ID and host ID | Current-host Native |
| Create user-owned task | Available, but policy requires explicit user request | Current-host Native with authority gate |
| Dispatch message | Directed task message is available | Delivery only, not ACK |
| Read target turn | Recent task turns can be read by stable ID | Current-host Native |
| Bounded snapshot | `timeoutMs=0` task wait is available | Current-host Native |
| Incremental cursor | Wait returns per-task cursor | Current-host Native |
| Multi-target wait | Wakes on first completion or attention event | Latency hint, not full sweep |
| Terminal gate before final | Plugin `Stop` Hook | Implemented locally; live acceptance pending |
| Durable report | Completed task record; optional filesystem report artifact | Level 2 adapter rule |
| Notification after durable report | One-shot directed message before final, receipt captured by `PostToolUse` | Hook-gated; live acceptance pending |
| Per-task full sweep | Iterate registered tasks with individual cursors | Required completeness gate |
| Executable Pre-final guard | Reference state store records freshness and refuses stale finalization | Locally verified; host wrapper required |
| Task archive | Archive tool available | Native after close gates |
| Worktree isolation | Available for eligible project tasks | Native with creation-policy gate |
| Automatic integration or Launch | Intentionally absent | Prohibited |

## Evidence boundary

OpenAI documents lifecycle Hooks at
[Hooks](https://learn.chatgpt.com/docs/hooks) and plugin packaging at
[Package plugins](https://developers.openai.com/plugins/build/plugins). Task primitives in
this table came from the current Codex desktop host inventory, not a stable
public cross-surface API reference. Reverify tool names, parameters, cursor
semantics, and authority rules on the installed host before each conformance
claim.

## Current gaps

- The calling task cannot wait on itself.
- A multi-target wait returns the first terminal/attention target and does not
  prove all other targets are unchanged.
- Successful send does not prove target acknowledgement.
- `send_message_to_thread` Hook coverage and receipt shape still need live
  verification on the installed desktop host.
- A live create/dispatch/ACK/completion test requires explicit authorization to
  create separate user-owned test tasks.

These gaps are why the adapter is Level 2 rather than Level 1.

The projectless create/ACK/wait/cursor/send/archive path was live-tested on
2026-08-09. Worktree and durable digest acceptance remain open; see the
[acceptance record](../testing/codex-live-acceptance-2026-08-09.md).

A removed Codex heartbeat experiment discovered a silent post-final completion
after 110.67 seconds on a nominal one-minute recurrence. It is historical
evidence for choosing one-shot Hook delivery, not a current feature. See the
[sleeping-controller record](../testing/codex-sleeping-controller-acceptance-2026-08-09.md).
