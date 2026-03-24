---
"@noron/dashboard": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Dashboard layout**
- Redesigned main dashboard to a bento grid: sparklines (temperature, CPU, memory) in a top strip; lock status, disk donut, and system info in a bottom row
- Disk sparkline replaced with a `DiskDonut` chart showing used/total GB
- Title changed from "Benchmark" to "Noron Benchmarks"

**Disk metrics**
- Disk usage sparkline and history added (fed from WebSocket `disk` field)
- `diskHistory` tracked and passed to sparkline in real time

**Permission wizard**
- New `PermissionWizard` component guides users through re-authorizing with GitHub or saving a fine-grained PAT when repo scope is missing
- `RunnerList` shows the wizard inline when `hasRepoScope` is false
- `RunnerSetup` detects GitHub API 403 errors and offers a "Fix Permissions" button inline
- Workflow YAML in `RunnerSetup` now uses the configured runner label from server config

**Bug fixes**
- Spinner shown while user info is loading on the runners page
- Optimistic runner list entries removed before re-fetching server state
- Sparkline animation: existing points no longer wobble on scroll; only the new tail point animates
- Removed `autoAdd` prop and auto-open side-effect from `RunnerList`; permission flow replaced with `PermissionWizard`

Significant visual refresh with improved disk visibility, smoother animations, and inline permission recovery flows.
