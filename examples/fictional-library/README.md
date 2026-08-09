# Fictional example: Lantern Library

Lantern Library is an imaginary static web catalog used only to demonstrate
coordination records. It has no real users, repositories, credentials, network
services, phone numbers, or business data.

## Mission

Add local catalog search and a printable book-detail view while preserving one
shared application entry point.

## Chart

```text
10 catalog inventory ─┐
                     ├─> 30 Captain integration ─> Dock
20 search module ─────┘
```

| Crew | Scope | Owned paths | Shared handoff |
| --- | --- | --- | --- |
| 10 | Inventory and book detail | `src/catalog.js`, `src/book-view.js` | Request exports in `src/app.js` |
| 20 | Search and tests | `src/search.js`, `tests/search.test.js` | Request route wiring in `src/app.js` |
| 30 | Captain integration | `src/app.js` | Integrate after 10 and 20 validate and stop edits |

Each dispatch receives a unique Assignment rather than relying on the Crew ID:

| Assignment | Worker | Origin | Branch policy | Dependency |
| --- | --- | --- | --- | --- |
| `assign-catalog-01` | 10 | `coordinator` | `ephemeral-cherry-pick` | none |
| `assign-search-01` | 20 | `coordinator` | `ephemeral-cherry-pick` | none |
| `assign-integrate-01` | 30 | `coordinator` | `persistent-merge` | Captain validation of 10 and 20 |

## Safety properties demonstrated

- Crew 10 and 20 can work in parallel because their writable paths are
  disjoint.
- `src/app.js` has one writer.
- Reports from 10 and 20 do not release ownership themselves.
- Dock requires combined verification after Captain integration.
- Delivery does not become running until the target echoes the Assignment ID
  and bounded scope.
- Each report is durable and digest-bound before its event is consumed.
- The Captain scans workers independently, so simultaneous completion cannot be
  hidden by a first-change multi-target wait.
- The example has no Launch action or external side effect.

The valid JSON fixtures under [`tests/fixtures/`](../../tests/fixtures/) show
the corresponding machine-readable records. The Codex-only flow is shown in
[`codex-walkthrough.md`](codex-walkthrough.md).
