---
"@noron/iso": patch
---

> Branch: fix-update-ui
> PR: https://github.com/thejustinwalsh/noron/pull/13

- ISO image now bundles `bench-updater.sh` from `provisioning/`
- ISO image now bundles static systemd unit files (`benchd.service`, `runner-ctld.service`) under `systemd/` for in-place service file updates

The ISO now ships the update script and systemd units needed for self-updating appliance deployments.
