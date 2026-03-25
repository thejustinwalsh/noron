---
"@noron/action": patch
---

> Branch: fix-update-ui
> PR: https://github.com/thejustinwalsh/noron/pull/13

- Tmpfs mount type verified at action startup; emits a workflow warning if the configured path is not actually a tmpfs mount (e.g. mount unit inactive)
- Per-session subdirectory created under the tmpfs mount (`<benchTmpfs>/<sessionId>/`, mode 1777) to prevent output file collisions between concurrent runs
- `TMPDIR` and `BENCH_TMPFS` environment variables now point to the session-scoped subdirectory rather than the top-level tmpfs path
- `perf-stat` output path updated to follow the session-scoped tmpfs dir

The action now validates the tmpfs mount and scopes all benchmark I/O to a per-session subdirectory, preventing file collisions and surfacing mount misconfiguration early.
