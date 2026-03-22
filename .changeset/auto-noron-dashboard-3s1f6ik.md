---
"@noron/dashboard": patch
---

> Branch: refactor-disk-image-flow
> PR: https://github.com/thejustinwalsh/noron/pull/2

- Page title renamed from "Benchmark Dashboard" to "Noron Dashboard"; favicon added
- `SystemInfo` component: CPU topology (total cores, housekeeping core, isolated cores) now sourced from the config API via `useConfig` hook instead of the `system` field on status updates
- `SystemInfo` prop `system` removed; local `SystemInfo` type and `system?` field on `StatusUpdate` removed from `types.ts`

Dashboard CPU topology display no longer depends on the status update stream; data comes from the dedicated config endpoint.
