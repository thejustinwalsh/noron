---
"@noron/setup": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Generated system configuration**
- Benchmark slice systemd unit now includes `Delegate=yes` to enable cgroup v2 delegation for job sub-cgroups
- `kernel.perf_event_paranoid` changed from `2` to `-1` to grant full access required by `perf stat` hardware counters
- Sudoers config updated: added `SETENV` flag and `Defaults:runner env_keep` for `BENCH_SESSION_ID`, `BENCH_JOB_TOKEN`, `BENCH_TMPFS`, and `TMPDIR` so bench-exec can propagate these through `sudo`

**Bug fix**
- Fixed systemd mount unit name generation: hyphens within path components are now escaped as `\x2d` (e.g., `mnt-bench\x2dtmpfs.mount`) per systemd unit naming rules

These changes are required for perf stat hardware counters to work and for bench-exec to correctly pass benchmark environment variables through privilege boundaries.
