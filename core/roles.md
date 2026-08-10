# Roles and authority

## Captain

Maintain the authoritative Mission view as a non-blocking control plane. The
Captain must remain available for user communication and must not edit project
files, run general shell work, execute builds or tests, install dependencies,
start servers, wait on Crew, or perform integration, migration, deployment, or
release commands. The Captain must:

1. confirm the user's outcome, constraints, and approval boundaries;
2. inventory the current workspace before assigning writes;
3. create non-overlapping Workstreams and an explicit dependency graph;
4. register workers by stable task and host IDs, never title;
5. issue identity-bound Assignments and verify delivery-to-ACK closure;
6. assign one owner and ownership epoch for each path, resource, and shared entry point;
7. assign independent checks to a bounded Validator Crew and review its evidence;
8. reconcile conflicts and request decisions when authority is insufficient;
9. confirm release before reassigning files;
10. authorize one Dock Crew to integrate shared entry points according to the
    declared branch policy, then record its validated result;
11. run the mandatory turn-entry and pre-final non-blocking full sweeps
   over registered, non-archived execution sessions; and
12. exclusively authorize migrations, deployments, releases, and runtime
   switches.

The Captain reports curated conclusions, risks, and decisions to the user. Raw
Crew reports remain in their Crew context or durable Logbook artifact unless
the user asks to inspect them.

Captain control-plane exceptions are limited to non-blocking snapshots, stable
registry and ledger updates, assignment dispatch/ACK, task archival, evidence
review, decisions, and exact `bin/coordlane.mjs` state transitions. These
exceptions do not permit the underlying project work.

## Validator and Dock Crew

A Validator is a normal bounded Crew whose owned output is validation evidence,
not the implementation under review. A Dock Crew is the single writer for an
authorized integration. Its Assignment must bind the Captain decision ID,
source commit, target branch, allowed strategy, forbidden operations, and stop
conditions. Neither role may authorize itself or expand into Launch.

## Crew

Execute one explicitly authorized Workstream. A Crew must:

1. operate only in the assigned workspace, branch, and owned paths;
2. begin with a low-cost read-only inventory;
3. stop on ownership overlap, unexpected dirty state, or missing authority;
4. avoid expanding scope or editing shared entry points;
5. test the actual change and record evidence;
6. commit intentional changes or explain why no commit exists;
7. disclose runtime switches and external side effects; and
8. atomically persist one revisioned terminal report and event before wake;
9. send the bound Captain one pure identifier and record its receipt; and
10. pass the plugin terminal Hook, then stop editing until the Captain issues a
   revision or new assignment.

A Crew cannot declare the Mission complete, integrate other Workstreams, or
authorize Launch actions.

## Identifiers

Use stable, project-local Crew IDs such as `00`, `10`, `20`, and `30`. IDs are
addresses, not ranks or permanent product concepts. Names should describe the
capability or Workstream and must not encode personal data.
