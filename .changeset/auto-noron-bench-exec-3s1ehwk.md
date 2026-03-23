---
"@noron/bench-exec": minor
---

> Branch: fix-runner-update
> PR: https://github.com/thejustinwalsh/noron/pull/3

## Changes

- Added `--perf-stat` flag: wraps the user command in `perf stat -d -x \t`, collecting hardware performance counters without affecting benchmark output
- Added `--perf-stat-output <path>` flag: destination for the raw TSV data (default `/tmp/bench-perf-stat.tsv`)
- After benchmark exit, parses the TSV and writes a `.json` sidecar with structured fields: `ipc`, `contextSwitches`, `cpuMigrations`, `branchMissRate`, `l1MissRate`, `isolationHealthy`
- Isolation health is `true` when context-switches ≤ 5 and cpu-migrations = 0; summary printed to stderr after each run
- `--perf-stat` exits with an error if `perf` is not available on the system (`isPerfAvailable()` check)
- New `perf-stat.ts`: parser (`parsePerfStat`), human-readable formatter (`formatPerfStatSummary`), and availability check (`isPerfAvailable`)
- New `perf-stat.test.ts`: covers counter parsing, IPC/branch-miss/L1-miss rate derivation, isolation health thresholds, empty input, malformed lines, and comma-formatted numbers
- `BENCH_SESSION_ID` and `BENCH_JOB_TOKEN` are now stripped from the child environment regardless of `--perf-stat` mode

Added `perf stat` hardware counter collection to `bench-exec`, enabling isolation health reporting and microarchitectural profiling alongside benchmark execution.
