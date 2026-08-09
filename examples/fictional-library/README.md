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
| 30 | Captain integration | `src/app.js` | Integrate only after 10 and 20 release |

## Safety properties demonstrated

- Crew 10 and 20 can work in parallel because their writable paths are
  disjoint.
- `src/app.js` has one writer.
- Reports from 10 and 20 do not release ownership themselves.
- Dock requires combined verification after Captain integration.
- The example has no Launch action or external side effect.

The valid JSON fixtures under [`tests/fixtures/`](../../tests/fixtures/) show
the corresponding machine-readable records.
