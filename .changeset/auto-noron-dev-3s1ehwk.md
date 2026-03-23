---
"@noron/dev": minor
---

> Branch: fix-runner-update
> PR: https://github.com/thejustinwalsh/noron/pull/3

## Changes

- `emulate.sh`: SBC disk images are automatically expanded to 8 GB before QEMU boot so `podman build` has enough space during emulated setup (real hardware uses 16–32 GB SD cards; Armbian resizes the filesystem on first boot)
- Snapshot mode tip added: message now suggests `--persist` when podman build may need disk space

Updated the emulation script to pre-expand SBC images to 8 GB, unblocking full setup testing in QEMU without a physical device.
