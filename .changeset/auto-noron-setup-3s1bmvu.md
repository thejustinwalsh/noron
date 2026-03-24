---
"@noron/setup": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Generated configs**

- `kernel.perf_event_paranoid` changed from `2` to `-1` — required for `perf stat` hardware counter access in runner containers
- Sudoers entry for `runner` updated: added `SETENV` flag and `env_keep` for `BENCH_SESSION_ID`, `BENCH_JOB_TOKEN`, `BENCH_TMPFS`, `TMPDIR` so environment variables survive the `sudo bench-exec` invocation
- Benchmark systemd slice now generated with `Delegate=yes` to enable cgroup subtree control delegation (cpuset, cpu, memory, pids)

**Installer**

- Fixed systemd mount unit naming: hyphens within path segments are now escaped as `\x2d` (e.g., `mnt-bench\x2dtmpfs.mount`) to comply with systemd unit naming rules

These changes are required for `perf stat`-based benchmarks to function correctly on freshly provisioned appliances.
