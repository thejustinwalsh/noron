---
"@noron/benchd": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

Socket security hardening:
- `umask(0o007)` applied before `listen()` to eliminate TOCTOU race between socket creation and permission application
- `CAP_CHOWN` and `CAP_FOWNER` added to `AmbientCapabilities` and `CapabilityBoundingSet` in the generated systemd unit so `chown root:bench` on the socket succeeds without `SYS_ADMIN`
- When running as root with `chown` failing (e.g., missing `CAP_CHOWN`), now logs a warning and falls back to `0o777` instead of calling `process.exit(1)`; job tokens remain the access-control boundary

Cgroup improvements:
- `CgroupManager` now lazily enables `cpuset`, `cpu`, `memory`, and `pids` subtree controllers on the benchmark slice before creating per-job cgroups, fixing failures on kernels that require explicit subtree delegation

Socket path change:
- Default socket path moved from `/var/run/benchd.sock` to `/run/benchd/benchd.sock` to align with the systemd `RuntimeDirectory=benchd` directive

These commits harden socket creation against race conditions, fix capability requirements for production deployments, and ensure cgroup v2 subtree control is correctly initialized before job execution.
