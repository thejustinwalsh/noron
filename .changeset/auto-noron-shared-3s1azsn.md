---
"@noron/shared": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- IPC socket path changed from `/var/run/benchd.sock` to `/run/benchd/benchd.sock` in `SOCKET_PATH` constant and `DEFAULT_CONFIG.socketPath`
- Socket directory (`/run/benchd/`) is now used as the canonical location, surviving daemon restarts without TOCTOU exposure

## BREAKING CHANGES

- `SOCKET_PATH` default is now `/run/benchd/benchd.sock`; existing deployments must update `BENCHD_SOCKET` environment variables and any tooling that references the old path

Moves the benchd IPC socket into a dedicated `/run/benchd/` directory, enabling directory-level volume mounts in containers and aligning with standard `RuntimeDirectory=` systemd conventions.
