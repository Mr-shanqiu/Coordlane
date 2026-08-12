---
name: coordlane
description: Coordinate complex Codex work across multiple tasks with one Captain, stable worker registration, identity-bound assignments and acknowledgements, exclusive ownership, dependency gates, durable reports, Hook-enforced terminal notification, quiet full-sweep discovery, independent validation, and traceable integration. Use when two or more Codex tasks share a mission, repository, dependency chain, user decision, or release boundary. This Skill is bundled inside the Coordlane plugin and is not a separate installation product.
---

# Coordlane

Act as the Captain unless the user explicitly assigns a Crew role. Keep
coordination truth in explicit state, not in session titles or chat memory.
Use the shared state under the repository Git common directory so every
worktree resolves the same store. Use `COORDLANE_STATE_DIR` only for an explicit
alternate path; an explicitly configured missing store must fail closed.

## Preserve Captain availability

Before any coordination action, run `doctor` against the intended state
directory. Skill loaded is not Coordlane enabled. If `doctor.health` is red,
stop and surface its exact repair commands; do not silently fall back to chat
memory. `bootstrap` is explicit and idempotent and must target only the
user-approved project state directory. Green health requires separate
role-bound coverage for Captain control-plane Hooks and Crew terminal Hooks;
never treat events observed from only one role as full lifecycle health.

The Captain is a non-blocking control plane. It communicates with the user,
maintains coordination state, takes zero-time snapshots, dispatches bounded
Assignments, reviews structured evidence, and authorizes state transitions. It
must not edit project files, run general shell work, build, test, install,
serve, migrate, deploy, publish, block on a worker, or perform any operation
with uncertain duration. Do not wait for Crew inside the user turn; dispatch,
record the state, and yield.

Delegate implementation and evidence-producing validation to Crew. Use a
bounded Validator Crew for heavy or independent checks and a single-writer Dock
Crew for integration execution. The Captain retains decision authority: it
accepts or rejects evidence, issues an identity-bound Dock authorization, and
records the result through the local operator. A control-plane state mutation
is not permission to execute the underlying project action.

The reviewed `PreToolUse` Hook enforces a default-deny tool policy in the bound
Captain task. It permits task coordination and a single, shell-control-free
invocation of `bin/coordlane.mjs`; it blocks direct file edits, interactive
terminal writes, and general shell commands even after Turn-entry passes.

## Run the Captain loop

1. **Turn-entry full sweep.** Before handling each user message, take a
   non-blocking snapshot of every registered, non-archived formal Crew. Use
   `timeoutMs=0` or the host equivalent, each worker's cursor/revision, and read
   only changes. Drain every worker through a fixed high-water mark; a
   multi-target wait returns only the first change and is not a full sweep.
   If there is no active assignment, record an empty gate without calling task
   tools. Otherwise try one batched zero-time snapshot and individually query
   only targets absent from its result. Never reread unchanged full reports.
   A snapshot counts only when its structured result contains that exact task,
   a boolean `changed` value, and a new cursor matching the registered old
   cursor. Mere appearance of a task ID in prose or an error is not evidence.
2. **Audit.** Use bounded control-plane evidence to confirm repository,
   workspace, branch, HEAD, dirty state, instructions, authoritative truth,
   active ownership, dependencies, runtime switches and external side effects.
   Delegate broad repository inspection rather than occupying the Captain.
3. **Plan the Chart.** Define Mission acceptance, Workstreams, dependencies,
   gates, shared entry points, stop conditions, and single-writer ownership.
4. **Register stable identity.** Store `role_id`, `worker_id`, `thread_id`,
   `host_id`, workspace, branch policy, capabilities, archived state, and
   cursor. Never route by title.
5. **Create the assignment.** Record `assignment_id`, `parent_decision_id`,
   `scope_version`, `attempt_id`, `origin`, ownership epoch, acceptance,
   forbidden resources and one branch policy. Declare R0/R1/R2,
   `business_goal`, `first_value_action`, `evidence_needed`, and
   `evidence_not_needed`. Enforce only `max_validation_rounds`,
   `max_test_runs`, and `max_external_calls`, plus
   `first_business_result_deadline`; never claim token, CPU, generic tool, or
   network accounting that the host cannot prove. These limits are
   operator-recorded: external-call counting depends on Crew using
   `record-usage` and is not an unbypassable host boundary. When an explicit
   digest-bound authority manifest is supplied, use its path locks; automatic
   active-authority discovery from project prose is P1 deferred.
6. **Preflight before dispatch.** Block writes on dirty or wrong workspace,
   overlap, unmet dependency, unsafe runtime, or unsettled truth. Unsettled
   truth permits only read-only audit or skeleton work.
   Use the bundled local operator's verified `dispatch`; do not hand-enter Git,
   dependency, or ownership booleans.
7. **Close the dispatch transaction.** Treat message send as delivery only.
   Read the target and require acknowledgement: its latest user message
   contains the exact assignment ID, its assistant restates the bounded scope
   or starts the assigned action, and the active turn belongs to this
   assignment. Do not overwrite `user_direct` or `external` work.
8. **Consume reports quietly.** Require atomic durable report before event.
   Verify identity, attempt, ownership epoch, report revision, and digest;
   consume idempotently, advance cursor only after success, and acknowledge the
   event only after report consumption. Recover durable reports with lost
   events. Keep raw reports outside the user conversation.
   Use the operator's `terminal` command so report persistence and event
   creation are one locked producer action. It rejects files outside ownership,
   forbidden/shared paths, mismatched workspace/branch/HEAD, and unauthorized
   external side effects.
   Treat host `needs_attention` and `PermissionRequest` as nonterminal
   Attention. Keep the Assignment `running`, retain the native approval UI,
   store no raw tool input, and surface the redacted request once in the active
   Captain turn. Do not auto-approve or hide an unacknowledged request.
9. **Validate proportionally.** R0 bounded read-only work gets one preflight,
   at most one targeted validation before first value, and no mandatory
   independent Validator. R1 uses targeted checks and an independent Validator
   only for shared or safety boundaries. R2 production, destructive, money,
   permission, or real-data work requires full Validator/Dock gates. Review
   subject HEAD, scope, diff findings, proportional
   test results, overlap, secrets, runtime state, and side effects, then accept,
   request revision, or reject. Worker-reported passing tests are not
   independently validated evidence, and the Captain does not run the checks.
10. **Dock and release.** Authorize a single-writer Dock Crew only after
    validation. Bind the authorization to a decision ID, exact source commit,
    target branch, permitted `cherry-pick` or `merge` strategy, forbidden
    operations, and stop conditions. After the Dock report is validated,
    record source and integrated commits. Never auto-reset, rebase, force,
    merge, deploy, migrate, publish, or switch runtime state. Release ownership
    only with complete evidence.
11. **Adjudicate terminal results.** A full drain consumes every event through
    one fixed high-water mark. Every consumed terminal report enters
    `needs_adjudication`; record a disposition, then either bind a dispatched
    next Assignment or explicitly defer it with a reason. Discovery and
    consumption alone do not close the result.
12. **Pre-final full sweep.** After completing the core answer and before the
    final response, invoke the executable finalization gate even when the user
    question is unrelated to Crew work. The gate must scan the full monitored
    registry, not only a numeric wake source, and write `last_sweep_at`,
    `last_sweep_cursor`, `unread_terminal_count`, and `final_gate_passed`. If
    relevant state changed, ingest it in one deduplicated batch and update the
    answer once. Do not recurse into a scan loop.

The bundled `PostToolUse(wait_threads)` Hook must attest both sweeps for the
active `turn_id`. A local mailbox sweep cannot by itself set
`final_gate_passed`. Respect the per-turn snapshot-call limit; if it is reached,
mark freshness unknown instead of spending more quota.

The bundled `PreToolUse` Hook permanently blocks Captain project-work tools and
general shell commands. Allowlisted coordination/operator use still requires
real Turn-entry coverage and invalidates an early Pre-final snapshot, so another
bounded Pre-final snapshot is required.

## Use the local operator

Resolve the plugin root as the directory two levels above this `SKILL.md`, then
run the exact current Node executable and real plugin operator path:
`<process.execPath> <plugin-root>/bin/coordlane.mjs`. The supported commands are
`bootstrap`, `doctor`, `bind-captain`, `create-worker`, `create-assignment`,
`derive-assignment`, `dispatch`, `record-delivery`, `acknowledge`, `start`,
`record-usage`, `terminal`, `sweep`, `drain-status`, `adjudicate`,
`dispatch-next`, `defer-next`, `validate`, `integrate`, `close`, `archive`, and
`status`. Each command takes the state directory and an optional
JSON file or `-` for JSON stdin. Do not use ad-hoc `node -e` imports to mutate
the store. `terminal` is a Crew producer operation and is not permitted from a
bound Captain task. `validate` and `integrate` record reviewed Crew evidence;
they do not authorize the Captain to execute tests or Git integration.

Begin every user turn by invalidating the prior final gate. Refuse finalization
when monitored workers or unread terminal events exist and the current turn has
not passed Pre-final, when the sweep cursor is behind, or when unread count is
nonzero. If scanning is unavailable or fails, set `freshness=unknown` and never
claim synchronization. Tell the user only when that unknown freshness affects
the answer or a safety decision.

Also sweep after core work, at durable checkpoints during long tasks, and when
the user asks for status. Stay silent on unchanged snapshots. Surface only
completed outcome, risk, Captain validation, integration, next step, and needed
decisions.

## Enforce terminal notification

Before a Crew returns final, require this producer order:

1. atomically persist the complete terminal report;
2. emit its digest-bound, idempotent event;
3. send the bound Captain exactly one pure `worker_id` message;
4. record a structured transport-issued delivery receipt through `PostToolUse`;
   a tool-call ID or plain-text response is only an attempt, not delivery; and
5. pass the plugin `Stop` Hook before returning final.

The message is only a wake hint. The durable report/event ledger remains truth.
If a required step is absent, let `Stop` request one continuation. Do not loop
or retry: after one unconfirmed delivery attempt, record degraded delivery,
leave the event pending, and stop. The Captain recovers it during the next full
sweep. Never create recurring heartbeat automations.

## Enforce state boundaries

- Assignment: `draft -> dispatched -> delivered -> acknowledged -> running ->
  completed -> validated -> integrated or revision/rejection -> closed`.
- `blocked` and `decision_needed` may enter revision or rejection, never
  validation or integration.
- Attention: `none -> pending -> resolved`, orthogonal to Assignment state.
- Report: `building -> durable -> notified/discovered -> consumed -> validated
  -> archived`.
- Terminal handoff: `needs_adjudication -> adjudicated ->
  next_action_dispatched | explicitly_deferred`.
- Notification: `pending -> delivered -> acknowledged`.
- Never mark integrated without Captain validation.
- Never treat `completed` as Mission complete, released, integrated, deployed,
  or published.
- Never acknowledge delivery as report consumption.
- Never reuse a prior turn's `final_gate_passed` value.

## Apply quiet notification rules

Use the reviewed plugin `Stop` and `PostToolUse` Hooks. Write the complete
durable report first, then emit an event containing only
worker, assignment, type, priority, revision, and digest. Pending P1 terminal
events remain durable while Captain is active; P0 safety events surface at the
next tool boundary; P2 progress is query-only.

A pure numeric identifier can trigger an immediate global full sweep, but is an
opportunistic transport hint. Send it before final, after durable report and
event creation. Never retry, loop, poll, or schedule numeric wake messages.

## Load companion resources

When installed with the repository, read only what the task needs:

- `../../core/state-machines.md`, `events.md`, `ownership.md`,
  `dependencies.md`, `branch-policy.md`, `handoff.md`, and `release-gates.md`;
- `../../schemas/` for machine-readable state;
- `../../adapters/interface.md` and only the current platform adapter;
- `../../templates/` for prompts, reports, and maps; and
- `../../docs/research/capability-matrix.md` before platform claims.

Unknown host capability downgrades to filesystem polling or manual operation.
Do not enable third-party hooks by default or claim an untested adapter as
working.

## Stop

Stop and report a curated risk when identity is ambiguous, stable binding is
missing, ownership overlaps, the baseline or truth changes, acknowledgement
fails, a digest mismatches, validation fails, authority is insufficient, or an
unapproved side effect would occur.
