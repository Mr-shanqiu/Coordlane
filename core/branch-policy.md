# Branch policy

Every write assignment selects exactly one policy before dispatch.

## Ephemeral cherry-pick

Use for short, disposable tasks:

- create a fresh branch or worktree from current Captain HEAD;
- commit the bounded result;
- a Validator produces independent evidence, the Captain authorizes, and a
  single-writer Dock Crew cherry-picks it;
- record source commit and integrated commit; and
- close and archive or rebuild the worker branch.

Do not continue treating the old worker branch as fast-forward compatible.

## Persistent merge

Use for a long-lived workstream:

- after Captain authorization, a single-writer Dock Crew merges the worker
  branch, preserving ancestry;
- when Captain advances, update the worker through a controlled merge from the
  integration branch; and
- never cherry-pick its commits and then demand later `ff-only` updates.

## Divergence rule

If histories diverged, compare trees, diffs, and patch equivalence first. A
controlled ordinary merge is allowed only when the policy permits it and the
merge is conflict-free. Stop on conflict. Coordlane never authorizes automatic
reset, rebase, force push, or destructive history repair.
