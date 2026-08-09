# Platform adapters

The current implementation phase supports only
[`codex/`](codex/README.md). It maps current Codex desktop task primitives to
the platform-neutral interface in [`interface.md`](interface.md).

Directories for Claude Code, CodeBuddy, WorkBuddy, and Generic preserve earlier
research notes only. They are not active adapters, are excluded from current
compatibility claims and tests, and must not be presented as supported. They
will be revisited only after Codex conformance testing is complete.

Before using any adapter, verify the exact product surface and installed
version, stable identity, completion semantics, cursor behavior, workspace
isolation, and fallback. Unknown capability is unavailable, not Native.
