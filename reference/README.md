# Filesystem reference coordinator

[`coordlane.mjs`](coordlane.mjs) is a small Node.js standard-library reference
for Coordlane's state machines and Level 3 mailbox fallback. It is executable,
but intentionally not a server or production orchestration platform.

```sh
node reference/coordlane.mjs init work/demo-state fictional-library
node reference/coordlane.mjs status work/demo-state
node reference/coordlane.mjs sweep work/demo-state
```

The exported module implements worker registration, identity-bound assignment
delivery and acknowledgement, ownership preflight, atomic durable reports,
digest-bound idempotent events, lost-event recovery, per-worker cursor sweeps,
Captain validation, branch-policy enforcement, ownership release, and worker
archival.

State is stored under the chosen directory:

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
authentication, daemon, hook installer, automatic Git mutation, or external
side effect is included. Use it as an auditable model and test harness.
