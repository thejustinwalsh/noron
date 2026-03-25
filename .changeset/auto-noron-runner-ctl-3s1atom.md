---
"@noron/runner-ctl": patch
---

> Branch: fix-update-ui
> PR: https://github.com/thejustinwalsh/noron/pull/13

- Added `SYS_ADMIN` capability to runner containers; required for `perf stat` hardware counter access on ARM64 — standard `CAP_PERFMON` is not honored by ARM64 PMU drivers alone
- `handleStatus` now probes the benchd socket inside the running container via `podman exec ... test -S`; returns a new `stale` state when the container is running but the socket is unreachable (indicates a `benchd` restart invalidated the bind mount)

Runner containers now support ARM64 `perf stat` and the status handler can distinguish a live container from one with a stale benchd socket mount.
