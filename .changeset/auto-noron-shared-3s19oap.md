---
"@noron/shared": patch
---

> Branch: fix-perf-pass
> PR: https://github.com/thejustinwalsh/noron/pull/15

- New `ThermalSensor` class replaces `ThermalRingBuffer` — unified sensor, ring buffer, and backfill store in one structure
- Internal storage uses `Uint32Array` (millidegrees) + `Float64Array` (timestamps) — zero allocations during benchmark polling
- FFI `pread()` via `bun:ffi`: keeps the sysfs fd open and re-reads in place; one syscall per poll, no open/close overhead
- `poll()` method replaces standalone `readCpuTemp()` — reads sensor, stores in ring, returns °C
- `currentTemp` getter replaces `latest()` method
- Backfill API: `beginBackfill()` / `recordBackfill()` / `flushBackfill()` for buffering readings taken while a benchmark holds the lock
- `trend()` threshold tightened from 1.5 °C to 0.5 °C; wide oscillation detection added (peak-to-peak > 2× threshold triggers rising/falling)
- `findCpuThermalZone()` is now exported
- New `ThermalBackfill` IPC message type added to protocol (`thermal.backfill`)

BREAKING CHANGES

- `ThermalRingBuffer` removed — replace with `ThermalSensor`
- `readCpuTemp()` removed — use `sensor.poll()` or `sensor.currentTemp`
- `latest()` method removed — use `currentTemp` getter
- `trend()` default threshold changed (1.5 °C → 0.5 °C); callers that relied on the old threshold must pass an explicit value

Rewrites the thermal subsystem around a single zero-GC structure; adds benchmark-period backfill tracking so the dashboard can reconstruct the full thermal trace after a run.
