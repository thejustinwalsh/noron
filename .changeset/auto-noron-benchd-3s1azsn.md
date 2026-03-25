---
"@noron/benchd": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

**Security audit and bug fixes**

- Fixed TOCTOU socket permission race: `umask(0o007)` is now set before the socket file is created rather than after `listen()` returns, preventing a window where the socket is accessible with wrong permissions
- Hardened socket security: when running as root, if the `bench` group is not found, benchd now exits with an error instead of falling back to a world-accessible socket (mode 0777)
- Fixed cgroup v2 controller delegation: `ensureSubtreeControl()` now writes `+cpuset +cpu +memory +pids` to `cgroup.subtree_control` on the benchmark slice before creating per-job child cgroups, fixing failures on systems where controllers are not delegated by default
- Added `Delegate=yes` to `benchmark.slice` systemd unit so the kernel allows benchd to manage controllers within the slice

Hardens the IPC socket against TOCTOU races, refuses insecure fallback when running as root, and fixes cgroup v2 controller delegation required for CPU/memory isolation.
