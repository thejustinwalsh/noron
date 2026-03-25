---
"@noron/shared": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- `SOCKET_PATH` constant changed from `/var/run/benchd.sock` to `/run/benchd/benchd.sock`
- `DEFAULT_CONFIG.socketPath` updated to match the new path

Standardized benchd socket location to `/run/benchd/benchd.sock` across all consumers.
