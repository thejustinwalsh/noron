---
"@noron/benchd": patch
---

> Branch: refactor-disk-image-flow
> PR: https://github.com/thejustinwalsh/noron/pull/2

- Socket permissions: `chown root:bench` applied before `chmod 0o770`; falls back to `0o777` in containers/LXC where chown is not permitted (job tokens still required for privileged ops)
- Removed `system` field from status update payload; CPU topology info is now served via the config API endpoint instead of being embedded in every status broadcast
- Thermal monitor now broadcasts status updates unconditionally, even when no thermal sensor is present (fixes missing CPU/memory/lock state in VMs and containers)

Improves container and VM compatibility for benchd while tightening socket ownership on real hardware.
