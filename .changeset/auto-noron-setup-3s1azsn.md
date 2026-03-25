---
"@noron/setup": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Generated systemd unit now includes `CAP_CHOWN` and `CAP_FOWNER` in both `AmbientCapabilities` and `CapabilityBoundingSet`, enabling benchd to set socket ownership without requiring a fallback to world-accessible permissions

This fixes socket permission setup when deploying from the setup wizard on systems where the `bench` group exists but capability grants were previously missing.
