# Codex capability matrix

Last reviewed: 2026-08-09

The current implementation phase tests only Codex desktop. Other platform
research is intentionally excluded from compatibility claims until Codex
acceptance is complete.

| Coordlane capability | Current Codex desktop evidence | V1 classification |
| --- | --- | --- |
| Portable Skill | Official Skill folder and frontmatter documentation | Verified packaging |
| Stable task identity | Task listing returns task ID and host ID | Current-host Native |
| Create user-owned task | Available, but policy requires explicit user request | Current-host Native with authority gate |
| Dispatch message | Directed task message is available | Delivery only, not ACK |
| Read target turn | Recent task turns can be read by stable ID | Current-host Native |
| Bounded snapshot | `timeoutMs=0` task wait is available | Current-host Native |
| Incremental cursor | Wait returns per-task cursor | Current-host Native |
| Multi-target wait | Wakes on first completion or attention event | Latency hint, not full sweep |
| Completion observer after final | Not established by current inventory | Unavailable/unverified |
| Durable report | Completed task record; optional filesystem report artifact | Level 2 adapter rule |
| Notification after durable report | Directed message before final only when artifact already exists | Opportunistic |
| Per-task full sweep | Iterate registered tasks with individual cursors | Required completeness gate |
| Task archive | Archive tool available | Native after close gates |
| Worktree isolation | Available for eligible project tasks | Native with creation-policy gate |
| Automatic integration or Launch | Intentionally absent | Prohibited |

## Evidence boundary

OpenAI documents Skill creation and installation at
[Build skills](https://learn.chatgpt.com/docs/build-skills). Task primitives in
this table came from the current Codex desktop host inventory, not a stable
public cross-surface API reference. Reverify tool names, parameters, cursor
semantics, and authority rules on the installed host before each conformance
claim.

## Current gaps

- The calling task cannot wait on itself.
- A multi-target wait returns the first terminal/attention target and does not
  prove all other targets are unchanged.
- Successful send does not prove target acknowledgement.
- No verified observer can call a tool after the worker's final answer.
- A live create/dispatch/ACK/completion test requires explicit authorization to
  create separate user-owned test tasks.

These gaps are why the adapter is Level 2 rather than Level 1.
