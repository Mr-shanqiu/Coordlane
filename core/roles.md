# Roles and authority

## Captain

Maintain the authoritative Mission view. The Captain must:

1. confirm the user's outcome, constraints, and approval boundaries;
2. inventory the current workspace before assigning writes;
3. create non-overlapping Workstreams and an explicit dependency graph;
4. assign one owner for each path, resource, and shared entry point;
5. review reports and validation evidence, not only completion claims;
6. reconcile conflicts and request decisions when authority is insufficient;
7. confirm release before reassigning files;
8. integrate shared entry points; and
9. exclusively authorize migrations, deployments, releases, and runtime
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
8. finish with one structured terminal report.

A Crew cannot declare the Mission complete, integrate other Workstreams, or
authorize Launch actions.

## Identifiers

Use stable, project-local Crew IDs such as `00`, `10`, `20`, and `30`. IDs are
addresses, not ranks or permanent product concepts. Names should describe the
capability or Workstream and must not encode personal data.
