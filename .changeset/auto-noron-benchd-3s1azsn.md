---
"@noron/benchd": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Set `umask(0o007)` before Unix socket creation to prevent TOCTOU race where connections could arrive before permissions were applied
- Socket chown failure (e.g., missing `CAP_CHOWN`) now falls back to `0o777` with a warning rather than a fatal exit; job tokens remain the privileged-op gate
- Added `CAP_CHOWN` and `CAP_FOWNER` to the generated systemd unit `AmbientCapabilities` and `CapabilityBoundingSet`
- `CgroupManager` now enables cpuset/cpu/memory/pids subtree controllers on the benchmark slice before the first job cgroup is created

Hardened socket lifecycle and cgroup setup; systemd unit now declares the capabilities needed for proper socket ownership.
