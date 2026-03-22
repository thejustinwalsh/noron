# @noron/iso

## 0.1.1

### Patch Changes

- [#2](https://github.com/thejustinwalsh/noron/pull/2) [`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: refactor-disk-image-flow

  > PR: https://github.com/thejustinwalsh/noron/pull/2

  - New `provisioning/img/build-img.sh`: builds bootable EFI disk images (x64/arm64) via debootstrap; output is a raw `.img` (optionally xz-compressed) flashable with `dd` or uploadable to cloud providers
  - `build-iso.sh`: ISO build directory now configurable via `ISO_BUILD_DIR` env var; live-build hook renamed and expanded to create the `bench` user, set locale, set default `bench:noron` password, install sudoers rules, and configure tty1 autologin for first-boot
  - `build-iso.sh`: installs `provisioning/profile.d/bench-setup.sh` into the ISO so the setup wizard launches automatically on console and SSH login
  - `first-boot.service`: `ExecStartPost` now removes the autologin override (`/etc/systemd/system/getty@tty1.service.d`) after setup completes rather than touching `.setup-complete` (the installer writes that itself)
  - New `provisioning/profile.d/bench-setup.sh`: launches `bench-setup` on first login for root (console) or bench user (SSH) if `.setup-complete` is absent
  - SBC image (`build-sbc-image.sh`): `ARMBIAN_DIR` and compression format configurable via env; bench user created and Armbian first-login wizard disabled in `customize-image.sh`; profile.d script installed; `NORON_COMPRESS=img` supported
  - `customize-image.sh`: `/etc/benchd` created with `root:bench:770` ownership; `/var/lib/bench` created with `bench:bench` ownership

  Adds a generic disk image build path for x86/cloud targets and unifies first-boot provisioning across ISO, SBC, and img image types.

- [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: main

  ### f7a95a1498ba99c0fc88a4dc467ece64672001ce

  fix: lint + types + optional chaining errors
  Files: biome.json, dev/local-test.ts, dev/mock-benchd.ts, packages/action/src/index.ts, packages/bench-exec/src/**tests**/syscalls.test.ts, packages/bench-exec/src/main.ts, packages/bench-exec/src/syscalls.ts, packages/benchd/src/**tests**/cgroup.test.ts, packages/benchd/src/**tests**/connection.test.ts, packages/benchd/src/**tests**/lock.test.ts, packages/benchd/src/**tests**/thermal.test.ts, packages/benchd/src/**tests**/tmpfs-cleanup.test.ts, packages/benchd/src/cgroup.ts, packages/benchd/src/connection.ts, packages/benchd/src/hooks/job-completed.ts, packages/benchd/src/hooks/job-started.ts, packages/benchd/src/lock.ts, packages/benchd/src/main.ts, packages/benchd/src/server.ts, packages/benchd/src/thermal.ts, packages/benchmark/src/bench.ts, packages/benchmark/src/report.ts, packages/cli/src/commands/monitor.tsx, packages/cli/src/commands/runners.ts, packages/cli/src/commands/status.ts, packages/cli/src/commands/update.ts, packages/cli/src/main.ts, packages/dashboard/src/App.tsx, packages/dashboard/src/components/AdminPanel.tsx, packages/dashboard/src/components/Layout.tsx, packages/dashboard/src/components/LockStatus.tsx, packages/dashboard/src/components/LoginPrompt.tsx, packages/dashboard/src/components/Onboarding.tsx, packages/dashboard/src/components/RepoCombobox.tsx, packages/dashboard/src/components/RunnerList.tsx, packages/dashboard/src/components/RunnerSetup.tsx, packages/dashboard/src/components/SparklineChart.tsx, packages/dashboard/src/components/StatusBar.tsx, packages/dashboard/src/components/SystemInfo.tsx, packages/dashboard/src/components/WorkflowDetail.tsx, packages/dashboard/src/components/WorkflowList.tsx, packages/dashboard/src/components/WorkflowsPage.tsx, packages/dashboard/src/hooks/useApi.ts, packages/dashboard/src/hooks/useWebSocket.ts, packages/dashboard/src/main.tsx, packages/dashboard/src/types.ts, packages/dashboard/vite-mock-plugin.ts, packages/dashboard/vite.config.ts, packages/iso/build-iso.ts, packages/iso/collect.ts, packages/setup/src/installer.ts, packages/shared/src/**tests**/protocol.test.ts, packages/shared/src/ipc-client.ts, packages/web/src/**tests**/ws-auth.test.ts, packages/web/src/crypto.ts, packages/web/src/main.ts, packages/web/src/routes/auth.ts, packages/web/src/routes/ws-status.ts, packages/web/src/workflows/**tests**/provision-runner.test.ts, tests/e2e/benchmark-lifecycle.test.ts
  Stats: 60 files changed, 820 insertions(+), 443 deletions(-)

- Updated dependencies [[`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c), [`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb), [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c), [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c), [`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb), [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c), [`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb), [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c)]:
  - @noron/bench-exec@0.1.1
  - @noron/benchd@0.1.1
  - @noron/cli@0.1.1
  - @noron/shared@0.1.1
  - @noron/web@0.1.1
  - @noron/setup@0.1.0
