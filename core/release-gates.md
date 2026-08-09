# Dock and Launch gates

## Dock: integration readiness

Before integration, the Captain confirms:

1. all required upstream Workstreams are terminal and Captain-validated;
2. worker claims are `release_pending`, with no-more-edits and complete release evidence;
3. commits or no-commit dispositions are identified;
4. validation evidence covers the combined change, not only isolated branches;
5. shared entry points have one integrator;
6. unresolved overlap and decisions are zero; and
7. rollback or recovery expectations are documented.

After integration, record the worker source commit and integrated commit,
re-run combined checks, then close the Assignment and release its ownership.

Passing Dock authorizes preparation of an integration. It does not authorize a
merge, push, migration, deployment, or public release unless that action is
separately within the user's granted authority.

## Launch: external action

Before Launch, confirm:

- the exact environment and target;
- the artifact or commit to release;
- the approving authority;
- required tests and their current results;
- migration and compatibility status;
- runtime switches and their intended final state;
- rollback or forward-recovery path; and
- monitoring and ownership after the action.

V1 never performs Launch automatically. A platform adapter may describe how a
host could request approval, but it must not weaken this core gate.

## Mission completion audit

The Mission is complete only when its acceptance criteria pass, every required
Workstream and Gate is accepted, ownership is released, external state is
known, and no required decision remains. A collection of `completed` Crew
reports is necessary evidence, not sufficient proof.
