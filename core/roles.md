# Roles and authority

## Captain

Maintain the authoritative Mission view. The Captain must:

1. confirm the user's outcome, constraints, and approval boundaries;
2. inventory the current workspace before assigning writes;
3. create non-overlapping Workstreams and an explicit dependency graph;
4. register workers by stable task and host IDs, never title;
5. issue identity-bound Assignments and verify delivery-to-ACK closure;
6. assign one owner and ownership epoch for each path, resource, and shared entry point;
7. review reports and independently reproduce proportional validation;
8. reconcile conflicts and request decisions when authority is insufficient;
9. confirm release before reassigning files;
10. integrate shared entry points according to the declared branch policy;
11. run the mandatory turn-entry and pre-final non-blocking full sweeps
   over registered, non-archived execution sessions; and
12. exclusively authorize migrations, deployments, releases, and runtime
   switches.

The Captain reports curated conclusions, risks, and decisions to the user. Raw
Crew reports remain in their Crew context or durable Logbook artifact unless
the user asks to inspect them.

## Crew

Execute one explicitly authorized Workstream. A Crew must:

1. operate only in the assigned workspace, branch, and owned paths;
2. begin with a low-cost read-only inventory;
3. stop on ownership overlap, unexpected dirty state, or missing authority;
4. avoid expanding scope or editing shared entry points;
5. test the actual change and record evidence;
6. commit intentional changes or explain why no commit exists;
7. disclose runtime switches and external side effects; and
8. atomically persist one revisioned terminal report before any wake hint; and
9. stop editing until the Captain issues a revision or new assignment.

A Crew cannot declare the Mission complete, integrate other Workstreams, or
authorize Launch actions.

## Identifiers

Use stable, project-local Crew IDs such as `00`, `10`, `20`, and `30`. IDs are
addresses, not ranks or permanent product concepts. Names should describe the
capability or Workstream and must not encode personal data.
