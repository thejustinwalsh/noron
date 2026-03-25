---
"@noron/shared": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- `SOCKET_PATH` constant changed from `/var/run/benchd.sock` to `/run/benchd/benchd.sock`
- `DEFAULT_CONFIG.socketPath` updated to match

The new path aligns with the systemd `RuntimeDirectory=benchd` directive and is consistent across all packages and provisioning scripts.
