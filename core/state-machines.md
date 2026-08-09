# State machines

State transitions are evidence gates, not labels inferred from chat activity.

## Assignment

```text
draft -> dispatched -> delivered -> acknowledged -> running
running -> completed | blocked | decision_needed | failed | superseded
completed | blocked | decision_needed -> validated | revision_requested | rejected
failed -> revision_requested | rejected | closed
validated -> integrated | revision_requested | rejected | closed
integrated | rejected | superseded -> closed
revision_requested -> running | superseded
```

`delivered` is not `acknowledged`. `completed` applies only to the assigned
scope. `validated` means Captain checks passed. `integrated` must record both
the worker source commit and integrated commit. `closed` requires ownership
release evidence.

Illegal transitions include:

- `dispatched -> integrated`;
- `delivered -> running` without identity-bound acknowledgement;
- a commentary or in-progress turn producing a terminal event;
- running when ownership, dependency, runtime, or budget preflight failed;
- terminal state without a durable report revision;
- integration before Captain validation; and
- release before commit disposition, workspace, verification, overlap,
  no-more-edits, runtime, and Captain checks all pass.

## Report

```text
building -> durable -> notified -> discovered -> consumed -> validated -> archived
                   `------------> discovered
```

`durable -> discovered` is the lost-notification recovery path. Report identity
is `(worker_id, assignment_id, attempt_id, report_revision, ownership_epoch)`;
its digest covers that identity and immutable content. A revised attempt writes
a new revision and never mutates old content.

## Notification

```text
pending -> delivered -> acknowledged
```

Delivery does not mean report consumption. Acknowledgement is written only
after the matching durable report passed digest verification and was consumed.
The idempotency key is `worker_id + assignment_id + report_revision`.

## Supersession and invalidation

A user steering a worker produces `origin=user_direct` and may supersede the
coordinator assignment. A changed truth source or dependency invalidates
downstream scope; affected workstreams become `stale` until the Captain issues
a new `scope_version` and, for writes, a new `ownership_epoch`.

## Finalization freshness

```text
turn begins -> final gate invalidated -> ordinary work -> pre-final full sweep
-> fresh and no unread terminal revisions -> final gate passed -> final allowed
```

Any new durable report or event invalidates the gate. Missing or failed scan
sets `freshness=unknown`. A gate from a prior turn, a cursor behind the event
sequence, or a nonzero unread terminal count cannot authorize final output.
