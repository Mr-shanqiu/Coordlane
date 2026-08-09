# Ownership and file release

## Single-writer rule

At any instant, each writable path or external resource has one owner. A broad
directory claim includes its descendants unless a narrower claim is explicitly
carved out before work begins.

Every claim has a monotonically increasing `ownership_epoch`. A worker must
echo the current epoch in its Assignment and report. Reassignment increments
the epoch; a stale worker cannot resume writes or release the new owner's claim.

Shared entry points have a Captain-designated integrator. Crew sessions do not
edit them concurrently. Instead, they report the exact change the integrator
must make.

## Conflict response

On a new or suspected overlap:

1. stop writes to the affected scope;
2. preserve existing user and Crew changes;
3. report the paths, owners, and observed state;
4. let the Captain re-scope, serialize, or request user direction; and
5. resume only after a new ownership record exists.

Do not resolve ownership conflicts by overwriting, force-resetting, or silently
absorbing another Crew's work.

## Completion is not release

Ownership can be released only after all of the following are recorded:

1. commit identifier, or an explicit no-commit reason;
2. final workspace status check;
3. validation evidence and result;
4. the Crew's commitment not to make further edits in the claimed scope;
5. Captain confirmation that no active claim overlaps;
6. runtime-state and external-side-effect disclosure; and
7. any shared-entry-point handoff.

The Captain first marks the worker claim `release_pending`, performs or assigns
integration under a single integration owner, then records `released` only
after reviewing all evidence. Use
[`schemas/ownership.schema.json`](../schemas/ownership.schema.json).
