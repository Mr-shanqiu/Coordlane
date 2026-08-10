# Filesystem reference coordinator

[`coordlane.mjs`](coordlane.mjs) is a small Node.js standard-library reference
for Coordlane's state machines and Level 3 mailbox fallback. It is executable,
but intentionally not a server or production orchestration platform.

[`../bin/coordlane.mjs`](../bin/coordlane.mjs) is the supported local operator
surface for the state-changing lifecycle. It accepts JSON from a file or stdin
instead of asking an agent to fabricate ad-hoc module calls.

```sh
node reference/coordlane.mjs init-repo . fictional-library
STATE_DIR="$(node reference/coordlane.mjs state-path .)"
node reference/coordlane.mjs bind-captain "$STATE_DIR" captain-thread local
node reference/coordlane.mjs begin-turn "$STATE_DIR"
node reference/coordlane.mjs status "$STATE_DIR"
node reference/coordlane.mjs sweep "$STATE_DIR"
node reference/coordlane.mjs pre-final "$STATE_DIR"
node reference/coordlane.mjs finalize "$STATE_DIR"
```

After initialization, use the operator for real state changes:

```sh
node bin/coordlane.mjs create-worker "$STATE_DIR" worker.json
node bin/coordlane.mjs create-assignment "$STATE_DIR" assignment.json
node bin/coordlane.mjs dispatch "$STATE_DIR" dispatch.json
node bin/coordlane.mjs record-delivery "$STATE_DIR" delivery.json
node bin/coordlane.mjs acknowledge "$STATE_DIR" acknowledgement.json
node bin/coordlane.mjs start "$STATE_DIR" start.json
node bin/coordlane.mjs terminal "$STATE_DIR" report.json
node bin/coordlane.mjs sweep "$STATE_DIR"
node bin/coordlane.mjs validate "$STATE_DIR" validation.json
```

`dispatch` derives the current Git workspace cleanliness and branch instead of
accepting those facts as booleans. Write assignments require
`truth_source_final: true`; declared external side effects require
`external_side_effects_approved: true`. `acknowledge` verifies an explicit task
snapshot containing the assignment in the latest user and assistant messages
and matching active assignment. `terminal` writes the durable report and its
digest-bound event as one locked producer operation.

The exported module implements worker registration, identity-bound assignment
delivery and acknowledgement, ownership preflight, atomic durable reports,
digest-bound idempotent events, lost-event recovery, per-worker cursor sweeps,
Captain validation, branch-policy enforcement, ownership release, and worker
archival.

`begin-turn` invalidates any prior final gate. `pre-final` performs the bounded
full sweep and writes freshness fields. `finalize` exits unsuccessfully when a
monitored registry has no current gate pass, the cursor is behind, unread
terminal reports remain, or freshness is unknown.

The plugin's `Stop` and `PostToolUse` Hooks enforce one-shot terminal delivery.
The reference store retains pending events when delivery degrades; no scheduled
heartbeat process is included.

For Git repositories, state is stored under the repository's Git common
directory as `<git-common-dir>/coordlane/`. Every linked worktree resolves to
the same store, while ordinary workspace edits do not include coordinator
state. Set `COORDLANE_STATE_DIR` only for an explicit alternate state directory.
An explicitly configured missing store fails closed at `Stop`.

```text
project.json
registry.json
ledger.json
ownership.json
assignments/*.json
reports/{worker_id}/{assignment_id}/{revision}.json
events/*.json
```

All public state mutations use a bounded cross-process lock, and recovery
reconciles event high-water marks plus durable reports interrupted before their
assignment update. Filesystem and process permissions remain the deployment
boundary: no remote authentication, daemon, automatic Git mutation, or external
side effect is included. Use it as an auditable local coordinator and test
harness, not a hostile multi-user security boundary.
