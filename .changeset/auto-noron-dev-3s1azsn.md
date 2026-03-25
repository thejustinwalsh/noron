---
"@noron/dev": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- `runner-ctl.sh` shell script replaced by the compiled `runner-ctld` binary across all provisioning scripts (ISO, SBC image, img, dev Makefile)
- `benchmark.slice` now includes `Delegate=yes` to enable cgroup v2 subdelegation, required for per-job cpuset/memory cgroups
- Release workflow generates and publishes SHA-256 checksum files (`.sha256`) alongside update archives for both `x64` and `arm64`

These infrastructure changes are prerequisites for cgroup v2 job isolation and verified self-updates.
