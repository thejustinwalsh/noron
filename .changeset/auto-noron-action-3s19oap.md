---
"@noron/action": patch
---

> Branch: fix-perf-pass
> PR: https://github.com/thejustinwalsh/noron/pull/15

- Replace `execSync` with `execFileSync` for tmpfs type check — avoids shell injection risk and passes arguments as an array
- Rebuild action dist to include updated `ThermalSensor` from `@noron/shared`

Fixes child process hardening for the tmpfs mount check and picks up the thermal sensor rewrite.
