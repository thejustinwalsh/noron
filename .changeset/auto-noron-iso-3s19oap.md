---
"@noron/iso": patch
---

> Branch: fix-perf-pass
> PR: https://github.com/thejustinwalsh/noron/pull/15

- `collect.ts` now writes a `version` file (from `@noron/iso` package.json) into the ISO dist output so `bench-updater apply` can update `/var/lib/bench/version` on the appliance

ISO build artifacts now include the version string used by the web service at runtime.
