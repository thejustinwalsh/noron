---
"@noron/benchmark": minor
---

> Branch: fix-runner-update
> PR: https://github.com/thejustinwalsh/noron/pull/3

## Changes

- Added `--perf-stat <dir>` CLI flag to `report.ts`: loads `perf-stat*.json` sidecar files from the specified directory
- Auto-detection fallback: if `--perf-stat` is omitted, looks for `perf-stat.json` next to each result file
- New "Isolation Health" section in the HTML report: per-run table showing isolation status badge (`HEALTHY` / `WARNING`), context switches, CPU migrations, IPC, branch miss rate, and L1 dcache miss rate
- Section is omitted when no perf stat data is found, preserving backward compatibility with plain result sets

Added an "Isolation Health" section to the benchmark HTML report, displaying per-run hardware counter data when perf stat sidecar files are present.
