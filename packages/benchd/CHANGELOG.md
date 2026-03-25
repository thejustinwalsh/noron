# @noron/benchd

## 0.3.2

### Patch Changes

- [#13](https://github.com/thejustinwalsh/noron/pull/13) [`c023daa`](https://github.com/thejustinwalsh/noron/commit/c023daaa1f13789fc6c5850500921a38b404f60a) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-update-ui

  > PR: https://github.com/thejustinwalsh/noron/pull/13

  - `CgroupManager.ensureSubtreeControl()` now always re-applies cgroup subtree control on every call instead of skipping after the first successful write; prevents stale cgroup configuration after `benchd` service restarts

  Cgroup subtree control is now reliably re-applied across service restarts, preventing silent failures when the benchmark slice loses its controller configuration.

- Updated dependencies [[`c023daa`](https://github.com/thejustinwalsh/noron/commit/c023daaa1f13789fc6c5850500921a38b404f60a)]:
  - @noron/shared@0.3.2

## 0.3.1

### Patch Changes

- [#11](https://github.com/thejustinwalsh/noron/pull/11) [`5101300`](https://github.com/thejustinwalsh/noron/commit/5101300fe81fff57b5a14bca3c73e2bb1317d705) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-security-audit-2

  > PR: https://github.com/thejustinwalsh/noron/pull/11

  Socket security hardening:

  - `umask(0o007)` applied before `listen()` to eliminate TOCTOU race between socket creation and permission application
  - `CAP_CHOWN` and `CAP_FOWNER` added to `AmbientCapabilities` and `CapabilityBoundingSet` in the generated systemd unit so `chown root:bench` on the socket succeeds without `SYS_ADMIN`
  - When running as root with `chown` failing (e.g., missing `CAP_CHOWN`), now logs a warning and falls back to `0o777` instead of calling `process.exit(1)`; job tokens remain the access-control boundary

  Cgroup improvements:

  - `CgroupManager` now lazily enables `cpuset`, `cpu`, `memory`, and `pids` subtree controllers on the benchmark slice before creating per-job cgroups, fixing failures on kernels that require explicit subtree delegation

  Socket path change:

  - Default socket path moved from `/var/run/benchd.sock` to `/run/benchd/benchd.sock` to align with the systemd `RuntimeDirectory=benchd` directive

  These commits harden socket creation against race conditions, fix capability requirements for production deployments, and ensure cgroup v2 subtree control is correctly initialized before job execution.

- Updated dependencies [[`3be0e74`](https://github.com/thejustinwalsh/noron/commit/3be0e74ba45268693c27eddb5a0734e039622e62)]:
  - @noron/shared@0.3.1

## 0.3.0

### Minor Changes

- [#9](https://github.com/thejustinwalsh/noron/pull/9) [`d3056b4`](https://github.com/thejustinwalsh/noron/commit/d3056b40f93ef6052d7ea85f9291164d3eddb46d) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-runner-auth-flow

  > PR: https://github.com/thejustinwalsh/noron/pull/9

  **Lock manager**

  - Lock holder disconnecting no longer triggers an auto-release grace period; lock stays held until the job-completed hook fires or the job timeout expires — this matches the expected lifecycle where the job-started hook process exits immediately after writing the token
  - Lock status response now includes `timeoutMs` (the effective timeout for the current holder)

  **System metrics**

  - Disk usage for the root filesystem now included in status broadcasts (`usedGb`, `totalGb`, `percent`) via `statfsSync`

  These changes stabilize lock handling for short-lived hook processes and extend status data to include disk metrics.

### Patch Changes

- Updated dependencies [[`d3056b4`](https://github.com/thejustinwalsh/noron/commit/d3056b40f93ef6052d7ea85f9291164d3eddb46d)]:
  - @noron/shared@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @noron/shared@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @noron/shared@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @noron/shared@0.2.0

## 0.1.1

### Patch Changes

- [#2](https://github.com/thejustinwalsh/noron/pull/2) [`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: refactor-disk-image-flow

  > PR: https://github.com/thejustinwalsh/noron/pull/2

  - Socket permissions: `chown root:bench` applied before `chmod 0o770`; falls back to `0o777` in containers/LXC where chown is not permitted (job tokens still required for privileged ops)
  - Removed `system` field from status update payload; CPU topology info is now served via the config API endpoint instead of being embedded in every status broadcast
  - Thermal monitor now broadcasts status updates unconditionally, even when no thermal sensor is present (fixes missing CPU/memory/lock state in VMs and containers)

  Improves container and VM compatibility for benchd while tightening socket ownership on real hardware.

- [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: main

  ### f7a95a1498ba99c0fc88a4dc467ece64672001ce

  fix: lint + types + optional chaining errors
  Files: biome.json, dev/local-test.ts, dev/mock-benchd.ts, packages/action/src/index.ts, packages/bench-exec/src/**tests**/syscalls.test.ts, packages/bench-exec/src/main.ts, packages/bench-exec/src/syscalls.ts, packages/benchd/src/**tests**/cgroup.test.ts, packages/benchd/src/**tests**/connection.test.ts, packages/benchd/src/**tests**/lock.test.ts, packages/benchd/src/**tests**/thermal.test.ts, packages/benchd/src/**tests**/tmpfs-cleanup.test.ts, packages/benchd/src/cgroup.ts, packages/benchd/src/connection.ts, packages/benchd/src/hooks/job-completed.ts, packages/benchd/src/hooks/job-started.ts, packages/benchd/src/lock.ts, packages/benchd/src/main.ts, packages/benchd/src/server.ts, packages/benchd/src/thermal.ts, packages/benchmark/src/bench.ts, packages/benchmark/src/report.ts, packages/cli/src/commands/monitor.tsx, packages/cli/src/commands/runners.ts, packages/cli/src/commands/status.ts, packages/cli/src/commands/update.ts, packages/cli/src/main.ts, packages/dashboard/src/App.tsx, packages/dashboard/src/components/AdminPanel.tsx, packages/dashboard/src/components/Layout.tsx, packages/dashboard/src/components/LockStatus.tsx, packages/dashboard/src/components/LoginPrompt.tsx, packages/dashboard/src/components/Onboarding.tsx, packages/dashboard/src/components/RepoCombobox.tsx, packages/dashboard/src/components/RunnerList.tsx, packages/dashboard/src/components/RunnerSetup.tsx, packages/dashboard/src/components/SparklineChart.tsx, packages/dashboard/src/components/StatusBar.tsx, packages/dashboard/src/components/SystemInfo.tsx, packages/dashboard/src/components/WorkflowDetail.tsx, packages/dashboard/src/components/WorkflowList.tsx, packages/dashboard/src/components/WorkflowsPage.tsx, packages/dashboard/src/hooks/useApi.ts, packages/dashboard/src/hooks/useWebSocket.ts, packages/dashboard/src/main.tsx, packages/dashboard/src/types.ts, packages/dashboard/vite-mock-plugin.ts, packages/dashboard/vite.config.ts, packages/iso/build-iso.ts, packages/iso/collect.ts, packages/setup/src/installer.ts, packages/shared/src/**tests**/protocol.test.ts, packages/shared/src/ipc-client.ts, packages/web/src/**tests**/ws-auth.test.ts, packages/web/src/crypto.ts, packages/web/src/main.ts, packages/web/src/routes/auth.ts, packages/web/src/routes/ws-status.ts, packages/web/src/workflows/**tests**/provision-runner.test.ts, tests/e2e/benchmark-lifecycle.test.ts
  Stats: 60 files changed, 820 insertions(+), 443 deletions(-)

- Updated dependencies [[`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb), [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c)]:
  - @noron/shared@0.1.1
