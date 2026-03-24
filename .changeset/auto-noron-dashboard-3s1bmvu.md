---
"@noron/dashboard": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Layout & branding**

- Renamed dashboard title to "Noron Benchmarks"
- Replaced grid layout with a bento layout (sparklines row + bottom row)

**New components**

- `LockStatus`: shows current lock holder, job ID, elapsed time, timeout, and queue depth
- `DiskDonut`: donut chart for disk usage
- `PermissionWizard`: guides users through GitHub OAuth scope upgrade or PAT entry when `repo` scope is missing

**Metrics**

- Added disk usage sparkline as a fourth metric card (alongside temp, CPU, memory)
- Disk color-codes by utilization: cyan < 50%, amber < 80%, red ≥ 80%

**UX**

- Added loading spinner while user info is fetching (replaces premature onboarding flash)
- Runner list and setup components updated to work with the new runner-ctl IPC flow
- Added Vite dev mock plugin to simulate WebSocket and API responses locally

Major dashboard overhaul adding live lock visibility, disk metrics, and a guided GitHub permissions flow.
