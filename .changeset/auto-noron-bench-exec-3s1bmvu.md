---
"@noron/bench-exec": patch
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**perf stat privilege flow**
- perf now runs as root (required for hardware counters) and drops privileges for the benchmark subprocess only, using `sudo -u $SUDO_USER -- env KEY=VAL …` rather than `sudo --preserve-env`
- Switched from `--preserve-env` to explicit `env KEY=VALUE` args to bypass sudoers `env_reset` on systems where the root rule lacks `SETENV`
- `BENCH_OUTPUT`, `BENCH_RUNNER`, `BENCH_RUN_INDEX`, `TMPDIR`, and `BENCH_TMPFS` are now reliably passed through to the benchmark process

**Isolation health check**
- `isolationHealthy` now only requires zero CPU migrations; context-switch count no longer checked

These fixes resolve environment-variable stripping under Debian's default sudoers `env_reset` policy when perf stat is used.
