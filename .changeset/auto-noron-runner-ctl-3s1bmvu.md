---
"@noron/runner-ctl": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**New package — `@noron/runner-ctl`**
- Introduces `runner-ctld`: a privileged Unix socket daemon that manages GitHub Actions runner container lifecycle on behalf of `benchd`
- IPC handlers: `provision` (start container), `deprovision` (stop and remove container), `status` (query container state)

**Container provisioning**
- Runner containers launched with all CPU cores in the cpuset (housekeeping + isolated) so the runner process and perf can see the full topology
- `SYS_NICE` and `SYS_ADMIN` capabilities added to containers (required for `taskset` and perf hardware counters)
- Environment variables written to per-runner env files and mounted into the container

**Input validation**
- Runner name: alphanumeric, dashes, and dots only; rejects path traversal and shell metacharacters
- Repo: must match `owner/repo` format; rejects newlines and shell metacharacters
- Label: alphanumeric and dashes only

Introduces the runner-ctld daemon as the privileged boundary for container operations, with strict input validation and comprehensive test coverage.
