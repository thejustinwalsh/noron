---
"@noron/dev": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- `test-vm` target now deploys `runner-ctld` binary instead of the legacy `runner-ctl.sh` shell script

Aligns the dev VM provisioning target with the current compiled runner-ctl daemon.
