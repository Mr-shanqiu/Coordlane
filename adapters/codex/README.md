# Codex adapter

## Classification

**Native in a verified supporting host; otherwise Manual.**

Codex supports portable Skills. The current Codex desktop test environment on
2026-08-09 also exposed primitives for spawning collaborators, listing their
state, waiting for bounded updates, sending direct messages, and receiving
results. Those callable primitives are runtime evidence for this environment,
not a promise that every Codex surface or future version exposes the same API.

## Mapping

| Core operation | Supporting host primitive | Fallback |
| --- | --- | --- |
| Load protocol | `coordlane` Skill | Copy Captain prompt |
| Create Crew | Spawn a subagent or user-owned task, according to host semantics | Start a separate session manually |
| Check Crew | List agents/tasks and use bounded wait/read | Ask user to open the Crew report |
| Radio | Query status once, then direct-message only if explicitly idle | Disabled |
| Dual turn gate | Non-blocking status/read snapshot at turn entry and pre-final, using the latest cursor when exposed | Manual changed-report check |

## Guardrails

- Use internal subagents for subtasks of the current request. Create a new
  user-owned task only when the user explicitly asks for a separate task.
- Do not assume a newly created task is complete; wait or read it explicitly.
- Do not implement Radio with retries, loops, timers, or automations.
- When the surface exposes task cursors, call its bounded wait/read primitive
  with `timeoutMs=0` and the stored cursor at both turn gates. Otherwise use the
  closest non-blocking revision snapshot and label the degradation.
- Scan only registered, non-archived formal execution tasks. Do not treat every
  sidebar chat or temporary helper as Crew.
- Treat `active`, absent, stale, failed, or unknown status as not idle.
- Keep full reports in Crew contexts and synthesize user-facing conclusions.
- Do not claim a stable public thread API from a current-session tool inventory.

## Evidence

- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI product changelog](https://learn.chatgpt.com/docs/changelog)
- Current-host capability inventory, observed 2026-08-09; not a public API
  contract.
