# Workstream protocol

## Readiness audit

Before assigning write work, record:

- repository or workspace root;
- current branch and HEAD, if applicable;
- dirty or untracked state;
- authoritative requirements and existing project instructions;
- current ownership claims;
- dependencies and shared entry points;
- allowed external side effects; and
- expected verification commands or evidence.

If the workspace is not the intended project, the baseline is ambiguous, or
unrelated dirty changes overlap the proposed scope, stop before editing.

## Workstream contract

Every Workstream must define:

- ID, title, objective, and acceptance criteria;
- Captain and assigned Crew;
- workspace, branch, and creation baseline;
- owned paths and forbidden paths;
- shared entry points that require Captain integration;
- upstream and downstream dependencies;
- gates and checkpoints;
- external-side-effect permission;
- terminal status rules; and
- required report format.

Use [`schemas/workstream.schema.json`](../schemas/workstream.schema.json) as the
machine-readable form.

## Lifecycle

`planned -> ready -> active -> terminal`

Terminal is exactly one of:

- `completed`: the authorized Workstream is actually complete;
- `blocked`: a concrete condition prevents further safe progress; or
- `decision_needed`: progress requires a Captain or user choice.

`completed` does not imply release, integration, or Mission completion.

## Parallelism rule

Parallelize only Workstreams whose owned paths and mutable resources are
disjoint and whose upstream gates have passed. Read-only work may overlap, but
each Crew must avoid creating incidental files or tool-generated changes in
another Crew's scope.
