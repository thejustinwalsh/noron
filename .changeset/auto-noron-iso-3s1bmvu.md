---
"@noron/iso": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

- Added `@noron/runner-ctl` as an ISO dependency so the `runner-ctld` binary is included in built images
- Removed `runner-ctl.sh` script from collected runner image assets (replaced by the compiled `runner-ctld` daemon from `@noron/runner-ctl`)

ISO images now include the runner-ctld daemon for managing runner container lifecycle.
