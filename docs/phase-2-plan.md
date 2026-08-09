# Next-stage plan

Do not begin another platform adapter until Codex acceptance is complete.

## 1. Codex live acceptance

- With explicit user authorization, create synthetic user-owned test tasks in
  an isolated fictional project.
- Verify create, delivery, ACK readback, user-direct steering detection,
  per-task cursor scans, two simultaneous completions, archive, and worktree
  identity on the exact desktop version.
- Install the plugin, review its Hooks, and test bundled Skill triggering.
- Verify `Stop` enforcement and `PostToolUse(send_message_to_thread)` receipts.
- Compare repository ledger state before and after a Captain restart.
- Downgrade any mapping that lacks repeatable evidence.

## 2. Codex packaging readiness

- Add contribution and security-reporting guidance.
- Repeat exact-name and prior-art checks before a tagged release.
- Publish one plugin installation unit; do not expose a standalone Skill
  installation path.
- Create no release until the user approves live evidence and release gates.

## 3. Deferred platform expansion

Only after steps 1 and 2 pass, select one additional platform, reread its
current official documentation, build one adapter against the common interface,
and run the same conformance suite. Existing non-Codex notes are research input,
not an implementation baseline.
