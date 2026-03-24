---
"@noron/bench-exec": patch
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Privilege handling for `perf stat`**

- When `--perf-stat` is used, `bench-exec` now stays root for `perf` (required for hardware counters) and drops privileges for the benchmark subprocess only, via `sudo -u <runner> -- env KEY=VAL cmd`
- Replaced `sudo --preserve-env=...` with explicit `env KEY=VAL` args to bypass Debian's `env_reset` when the sudoers rule lacks `SETENV`
- Without `--perf-stat`, privileges are dropped normally before exec (unchanged behavior)

**Isolation health check**

- `isolationHealthy` now only requires `cpuMigrations === 0`; removed the context-switch threshold check that caused false negatives

Fixes environment variable stripping under `perf stat` on Debian-based runner images and corrects the isolation health signal.
