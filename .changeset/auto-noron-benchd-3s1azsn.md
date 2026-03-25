---
"@noron/benchd": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Socket creation now sets `umask(0o007)` before `listen()` to prevent a TOCTOU race where connections could arrive before permissions are applied
- Added `CAP_CHOWN` and `CAP_FOWNER` to `AmbientCapabilities` and `CapabilityBoundingSet` in the generated systemd service so that socket chown to `root:bench` succeeds reliably
- When chown fails (e.g., missing `CAP_CHOWN`), daemon now logs a warning and falls back to `0o777` instead of exiting; job tokens remain the authoritative access-control boundary
- `CgroupManager` now enables `cpuset`, `cpu`, `memory`, and `pids` subtree controllers on the benchmark slice before creating per-job cgroups (`ensureSubtreeControl`)

## BREAKING CHANGES

- Default socket path is now `/run/benchd/benchd.sock`; update `BENCHD_SOCKET` on existing deployments

Hardens the benchd daemon's socket lifecycle and cgroup setup, ensuring correct permissions on first connection and stable cgroup v2 controller availability for benchmark jobs.
