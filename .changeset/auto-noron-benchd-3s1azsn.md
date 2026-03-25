---
"@noron/benchd": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Socket creation now sets `umask(0o007)` before calling `listen()`, eliminating the TOCTOU race window between socket creation and permission application
- When running as root and `chown root:bench` fails (e.g., missing `CAP_CHOWN`), server now falls back to `0o777` with a warning rather than exiting; job tokens remain the authoritative access-control boundary
- Cgroup subtree control (`+cpuset +cpu +memory +pids`) is now enabled on the benchmark slice automatically before creating the first per-job cgroup, fixing cgroup v2 setups where subdelegation was not pre-configured
- Added `CAP_CHOWN` and `CAP_FOWNER` to `AmbientCapabilities` and `CapabilityBoundingSet` in the generated systemd unit so socket ownership can be set without root fallback

These changes harden socket security, fix cgroup v2 permission setup, and ensure the generated systemd unit carries the capabilities required for secure operation.
