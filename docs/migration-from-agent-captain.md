# Migration from Agent Captain drafts

Coordlane is the project and Skill name. Existing drafts that used “Agent
Captain” can migrate without preserving the old term as a runtime alias.

1. Install or invoke `coordlane`; remove the old Skill folder after confirming
   no active task references it.
2. Rename project documents and prompt headers to Coordlane. The coordinator
   role remains `Captain` and execution roles remain `Crew`.
3. Replace fire-and-forget pure-number handoff with durable report revisions,
   digest-bound events, per-worker cursors, and safe-point full sweeps.
4. Add stable `thread_id + host_id`, `assignment_id`, `parent_decision_id`,
   `scope_version`, `attempt_id`, `origin`, and `ownership_epoch` to ledgers.
5. Treat message send as delivery only. Require target acknowledgement before
   `running`.
6. Select `ephemeral-cherry-pick` or `persistent-merge` per assignment and stop
   mixing their histories.
7. Validate worker claims independently and record source-to-integrated commit
   mapping before closing and releasing files.

Old human report text can be retained as archived evidence, but only a report
conforming to the current schema enters the new state machine. No automatic
conversion should guess stable IDs, origin, digest, or validation evidence.
