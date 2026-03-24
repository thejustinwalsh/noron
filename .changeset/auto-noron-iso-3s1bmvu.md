---
"@noron/iso": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

- Added `@noron/runner-ctl` to the ISO asset collection so the `runner-ctld` daemon is bundled in the appliance image

ISO now includes the runner-ctl package required for the new runner provisioning IPC flow.
