---
"@noron/web": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Runner provisioning workflows**
- Provision and heal workflows now use `RunnerCtlClient` to communicate with the `runner-ctld` Unix socket daemon instead of invoking podman directly
- Default callback URL port corrected from `3000` to `9216` (matches the bench-web service port)
- `deprovision-runner` and `self-update` workflows updated accordingly
- Health check updated to work with new runner-ctld architecture

**Admin API**
- Lock status in admin route now includes `timeoutMs`

**Config API**
- `/api/config` response now includes `runnerLabel` so the dashboard can display the correct runner label in workflow YAML snippets

Runner provisioning is now fully mediated through runner-ctld, separating privileged container operations from the web process.
