---
"@noron/iso": patch
---

> Branch: refactor-disk-image-flow
> PR: https://github.com/thejustinwalsh/noron/pull/2

- New `provisioning/img/build-img.sh`: builds bootable EFI disk images (x64/arm64) via debootstrap; output is a raw `.img` (optionally xz-compressed) flashable with `dd` or uploadable to cloud providers
- `build-iso.sh`: ISO build directory now configurable via `ISO_BUILD_DIR` env var; live-build hook renamed and expanded to create the `bench` user, set locale, set default `bench:noron` password, install sudoers rules, and configure tty1 autologin for first-boot
- `build-iso.sh`: installs `provisioning/profile.d/bench-setup.sh` into the ISO so the setup wizard launches automatically on console and SSH login
- `first-boot.service`: `ExecStartPost` now removes the autologin override (`/etc/systemd/system/getty@tty1.service.d`) after setup completes rather than touching `.setup-complete` (the installer writes that itself)
- New `provisioning/profile.d/bench-setup.sh`: launches `bench-setup` on first login for root (console) or bench user (SSH) if `.setup-complete` is absent
- SBC image (`build-sbc-image.sh`): `ARMBIAN_DIR` and compression format configurable via env; bench user created and Armbian first-login wizard disabled in `customize-image.sh`; profile.d script installed; `NORON_COMPRESS=img` supported
- `customize-image.sh`: `/etc/benchd` created with `root:bench:770` ownership; `/var/lib/bench` created with `bench:bench` ownership

Adds a generic disk image build path for x86/cloud targets and unifies first-boot provisioning across ISO, SBC, and img image types.
