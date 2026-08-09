# Filesystem reference coordinator

[`coordlane.mjs`](coordlane.mjs) is a small Node.js standard-library reference
for Coordlane's state machines and Level 3 mailbox fallback. It is executable,
but intentionally not a server or production orchestration platform.

```sh
node reference/coordlane.mjs init .coordlane fictional-library
node reference/coordlane.mjs bind-captain .coordlane captain-thread local
node reference/coordlane.mjs begin-turn .coordlane
node reference/coordlane.mjs status .coordlane
node reference/coordlane.mjs sweep .coordlane
node reference/coordlane.mjs pre-final .coordlane
node reference/coordlane.mjs finalize .coordlane
```

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

State is stored under `.coordlane/` by default so plugin Hooks can discover it
from any repository subdirectory. Set `COORDLANE_STATE_DIR` only when an
explicit alternate state directory is required:

```text
project.json
registry.json
ledger.json
ownership.json
assignments/*.json
reports/{worker_id}/{assignment_id}/{revision}.json
events/*.json
```

Limitations: one local writer should own each record; filesystem and process
permissions are the deployment boundary; no file locking, remote transport,
authentication, daemon, automatic Git mutation, or external side effect is
included. Use it as an auditable model and test harness.
