# Platform capability matrix

Last reviewed: 2026-08-09

This matrix records only evidence found in official product documentation or a
current host capability inventory. Product behavior changes; re-check before a
public compatibility claim.

| Capability | Codex | Claude Code | CodeBuddy | WorkBuddy | Generic |
| --- | --- | --- | --- | --- | --- |
| Portable Skill | Native | Native | Native | Native at product level | Manual prompt |
| Isolated worker | Native in supporting host | Native subagent | Native subagent | Multi-expert product claim; API unverified | Manual session |
| Multi-session team | Native in current host; surface-dependent | Native, experimental | Native, experimental | Product-level only; lifecycle unverified | Manual |
| Shared task dependencies | Captain protocol; host-dependent | Native in experimental Agent Teams | Native in experimental Agent Teams | Unverified | Manual Chart |
| Direct agent messaging | Native in current host | Native in Agent Teams | Native in Agent Teams | Unverified | Manual |
| Fresh idle/status query | Native in current host | Team status/idle events; exact query not claimed | Status UI and idle hooks | Unverified | Unavailable |
| Terminal callback | Native result delivery | Hook-assisted | Hook-assisted, beta | Unverified | Manual |
| Dual turn gate | Native in a supporting host with bounded cursor reads; otherwise Manual | Native or Manual by installed team surface | Native or Manual by installed team surface | Manual; incremental API unverified | Manual registry check |
| Conditional pure-ID Radio | Native only when fresh idle is exposed | Disabled by default | Hook-assisted, not shipped | Disabled | Disabled |
| Worktree isolation | Git/manual or host support | Official worktree sessions | Manual Git worktrees | Unverified | Manual Git |
| No-hook fallback | Manual | Manual | Manual | Manual | Manual |

## Evidence notes

### Codex

OpenAI documents the Skill folder model and progressive disclosure. The
current Codex desktop host exposed collaborator/task creation, list, bounded
wait/read, and direct-message primitives during this review. Because no stable
public page was found for every callable thread primitive, the adapter labels
them current-host evidence rather than a universal API.

- [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [Customization overview](https://learn.chatgpt.com/docs/customization/overview#skills)
- [OpenAI changelog](https://learn.chatgpt.com/docs/changelog)

### Claude Code

Official documentation covers isolated subagents, experimental Agent Teams
with shared tasks and messaging, worktree sessions, and lifecycle hooks. It
also documents important recovery, task-state, nesting, and file-isolation
limits.

- [Agent teams](https://code.claude.com/docs/en/agent-teams)
- [Run agents in parallel](https://code.claude.com/docs/en/agents)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Hooks](https://code.claude.com/docs/en/hooks)

### CodeBuddy

Official documentation covers Skills, subagents, experimental Agent Teams,
beta hooks, and research-preview Dynamic Workflows. Security guidance states
that non-built-in frontmatter hooks are not trusted by default.

- [Agent Teams](https://www.codebuddy.ai/docs/cli/agent-teams)
- [Sub-agents](https://www.codebuddy.ai/docs/cli/sub-agents)
- [Skills](https://www.codebuddy.ai/docs/cli/skills)
- [Hooks](https://www.codebuddy.ai/docs/cli/hooks)
- [Dynamic Workflows](https://www.codebuddy.ai/docs/cli/workflows)

### WorkBuddy

Official product pages establish custom Skills and multi-expert collaboration,
but the bounded review did not locate an official developer reference for
session status, directed messaging, or lifecycle callbacks. V1 therefore does
not claim Native Radio or terminal callbacks.

- [Official product page](https://www.workbuddy.cn/work/)
- [Tencent Cloud product page](https://cloud.tencent.com.cn/product/workbuddy)
- [Official product guide](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Product-Guide)
