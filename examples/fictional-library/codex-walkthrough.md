# Synthetic Codex walkthrough

This walkthrough contains no real task IDs, repository address, user data, or
external service.

1. Captain registers Crew 10 and 20 with synthetic `thread_id + host_id`,
   separate worktrees, independent cursors, and disjoint ownership.
2. Captain creates `assign-catalog-01` and `assign-search-01`, preflights both,
   and sends their Crew prompts.
3. Send success records `delivered`. Captain reads each target; only an exact
   assignment echo and matching active turn records `acknowledged`, then
   `running`.
4. Crew 10 completes first. Its completed task report is revision 1. A P1 event
   remains pending while Captain answers the user and does not inject raw
   report text.
5. Crew 20 completes before the same Pre-final gate. Even if one multi-target
   wait returns only Crew 10, the full sweep reads both independent cursors and
   consumes both revisions.
6. Captain checks both diffs and reruns targeted tests. Worker results remain
   labeled worker-reported; reproduced checks are Captain-verified.
7. Captain creates the integration assignment for Crew 30, preserves
   `src/app.js` as a single-writer resource, and records the two dependencies.
8. After combined verification, Captain records source and integrated commits,
   closes assignments, releases ownership, and reports a curated outcome.

If a Crew is user-steered during step 3, Captain records `origin=user_direct`
and does not overwrite it. If a durable report digest mismatches its event, the
sweep stops consumption and surfaces a risk rather than accepting partial text.
