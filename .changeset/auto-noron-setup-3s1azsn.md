---
"@noron/setup": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Generated benchd systemd service now sets `BENCHD_SOCKET=/run/benchd/benchd.sock` and cleans up the new socket path on start
- Generated service adds `CAP_CHOWN` and `CAP_FOWNER` to `AmbientCapabilities` and `CapabilityBoundingSet` so socket ownership can be set to `root:bench`

## BREAKING CHANGES

- Re-run setup (`noron-setup`) on existing appliances to regenerate systemd units with the updated socket path and capabilities

Updated generated systemd service units reflect the new socket location and the minimal capability set needed for secure socket ownership.
