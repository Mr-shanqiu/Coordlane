# Runtime state and external side effects

Runtime State includes feature flags, running processes, database migrations,
network services, deployments, releases, external messages, and modifications
outside the assigned workspace.

## Default

The default permission is no external side effects. Read-only inspection is
allowed only when it stays within the assigned scope and does not expose
secrets.

## Authority

Crew sessions may prepare code or instructions for a Runtime State change, but
only the Captain may authorize execution, and only within authority explicitly
granted by the user. Destructive, irreversible, public, or production actions
require an exact target and a fresh approval when not already authorized.

## Report requirements

Every terminal report states:

- whether any process or service was started;
- whether any switch, migration, deployment, or external message changed;
- what remains running or externally visible; and
- what cleanup or reversal is available.

`none` is an explicit value, not an omitted field.
