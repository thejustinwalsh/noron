---
"@noron/action": minor
---

> Branch: fix-runner-update
> PR: https://github.com/thejustinwalsh/noron/pull/3

## Changes

- Added `perf-stat` input (default `false`): when enabled, wraps the benchmark command in `perf stat -d` to collect hardware performance counters (context switches, CPU migrations, IPC, branch miss rate, L1 dcache miss rate)
- Added `perf-stat-json` output: path to the JSON results file, set only when `perf-stat: true`; usable in downstream workflow steps
- Isolation health logged to the Actions step summary after the benchmark: `HEALTHY` when context-switches ≤ 5 and cpu-migrations = 0, `WARNING` otherwise
- Fixed `use-tmpfs: false` being ignored — tmpfs is now correctly skipped when the input is set to `false`
- Default thermal target temperature changed from 45 °C to 0 (auto); log message updated to reflect "auto" mode
- Updated CI workflow: benchmark step captures `perf-stat-json` output and uploads the sidecar JSON artifact alongside results; report step passes `--perf-stat` dir to the report generator

Added `perf stat` hardware counter collection to the action, surfacing CPU isolation health and microarchitectural metrics as a first-class output.
