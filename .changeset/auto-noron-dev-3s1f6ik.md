---
"@noron/dev": patch
---

> Branch: refactor-disk-image-flow
> PR: https://github.com/thejustinwalsh/noron/pull/2

- Makefile: `.env.local` / `.env` auto-loaded; `BUN_TARGET` derived from `ARCH` when not set via env
- Makefile: new targets — `sbc` (build SBC image), `emulate-iso`, `emulate-sbc` (QEMU boot), `emulate-fetch` (download pre-built image)
- `test-vm` target no longer auto-launches the setup wizard; now provisions bench user, sudoers, locale, and profile.d script and prints instructions for manual launch
- New `dev/emulate.sh`: boots a Noron SBC image or ISO in QEMU for local testing
- New `dev/sbc.sh`: helper for SBC image operations
- New `dev/test-img.sh`: helper for testing disk images
- New `dev/emulate-local.sh`: local emulation helper
- `collect-dist` now runs from the repo root; `BUN_TARGET` no longer hard-coded in the make invocation
- `NORON_COMPRESS` env var controls image compression (`xz` or `img`) across ISO, SBC, and disk image builds

Adds QEMU-based local emulation workflow and simplifies development iteration for all image types.
