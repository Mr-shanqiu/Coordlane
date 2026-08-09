# Platform adapters

Adapters translate the platform-independent protocol in [`core/`](../core/)
into host capabilities. They are informative, not normative.

Before using an adapter:

1. identify the exact product surface and installed version;
2. confirm the named capabilities exist in the current session;
3. keep experimental and host-private capabilities labeled;
4. review any hook before enabling it; and
5. fall back to Generic whenever a claim cannot be verified.

Capability levels are Native, Hook-assisted, Polling, and Manual. See the
[dated matrix](../docs/research/capability-matrix.md).
