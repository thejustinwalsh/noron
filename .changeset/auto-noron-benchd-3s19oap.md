---
"@noron/benchd": patch
---

> Branch: fix-perf-pass
> PR: https://github.com/thejustinwalsh/noron/pull/15

- `ThermalMonitor` now delegates all ring buffer storage and sysfs reads to the shared `ThermalSensor` instance
- Server creates a single `ThermalSensor` sized to hold the full thermal history plus worst-case job timeout duration; opens the FFI sensor at startup
- On lock acquire: `beginBackfill()` is called; each poll during a benchmark calls `recordBackfill()` instead of broadcasting a status update
- On lock release: buffered readings flushed to all subscribers as a `thermal.backfill` IPC message so the dashboard can reconstruct the thermal trace
- Status updates skip `/proc/stat`, `/proc/meminfo`, and `statfs()` reads while the lock is held — stale cached values are sent instead to eliminate memory bus traffic and cache pressure during benchmarks
- Disk reads throttled to at most once per 60 s even when the lock is not held
- `ensureSubtreeControl()` in `CgroupManager` now short-circuits after first success instead of re-applying on every lock acquire
- Workflow run history capped at 20 entries (down from 100)
- `bench-updater rollback`: verifies all required binaries exist in the backup before attempting rollback

Wires the new `ThermalSensor` backfill API into the server lock lifecycle and eliminates all non-essential I/O from the benchmark hot path.
