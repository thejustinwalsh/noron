---
"@noron/dev": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

**Security audit and bug fixes**

- Updated `test-vm` Makefile target to deploy the compiled `runner-ctld` binary (from `dist/runner-ctl/runner-ctld`) instead of the legacy `runner-ctl.sh` shell script

Dev test-VM tooling now tracks the rename of runner-ctl from a shell script to a compiled daemon binary.
