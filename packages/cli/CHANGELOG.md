# @noron/cli

## 0.3.2

### Patch Changes

- [#13](https://github.com/thejustinwalsh/noron/pull/13) [`c023daa`](https://github.com/thejustinwalsh/noron/commit/c023daaa1f13789fc6c5850500921a38b404f60a) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-update-ui

  > PR: https://github.com/thejustinwalsh/noron/pull/13

  - New `noron update rollback` command to roll back the appliance to the previously installed version
  - Calls `POST /api/update/rollback` on the configured bench-web server; reports the version rolled back from on success

  The CLI now supports manual rollback via `noron update rollback`.

- Updated dependencies [[`c023daa`](https://github.com/thejustinwalsh/noron/commit/c023daaa1f13789fc6c5850500921a38b404f60a)]:
  - @noron/shared@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`3be0e74`](https://github.com/thejustinwalsh/noron/commit/3be0e74ba45268693c27eddb5a0734e039622e62)]:
  - @noron/shared@0.3.1

## 0.3.0

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

- [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: main

  ### f7a95a1498ba99c0fc88a4dc467ece64672001ce

  fix: lint + types + optional chaining errors
  Files: biome.json, dev/local-test.ts, dev/mock-benchd.ts, packages/action/src/index.ts, packages/bench-exec/src/**tests**/syscalls.test.ts, packages/bench-exec/src/main.ts, packages/bench-exec/src/syscalls.ts, packages/benchd/src/**tests**/cgroup.test.ts, packages/benchd/src/**tests**/connection.test.ts, packages/benchd/src/**tests**/lock.test.ts, packages/benchd/src/**tests**/thermal.test.ts, packages/benchd/src/**tests**/tmpfs-cleanup.test.ts, packages/benchd/src/cgroup.ts, packages/benchd/src/connection.ts, packages/benchd/src/hooks/job-completed.ts, packages/benchd/src/hooks/job-started.ts, packages/benchd/src/lock.ts, packages/benchd/src/main.ts, packages/benchd/src/server.ts, packages/benchd/src/thermal.ts, packages/benchmark/src/bench.ts, packages/benchmark/src/report.ts, packages/cli/src/commands/monitor.tsx, packages/cli/src/commands/runners.ts, packages/cli/src/commands/status.ts, packages/cli/src/commands/update.ts, packages/cli/src/main.ts, packages/dashboard/src/App.tsx, packages/dashboard/src/components/AdminPanel.tsx, packages/dashboard/src/components/Layout.tsx, packages/dashboard/src/components/LockStatus.tsx, packages/dashboard/src/components/LoginPrompt.tsx, packages/dashboard/src/components/Onboarding.tsx, packages/dashboard/src/components/RepoCombobox.tsx, packages/dashboard/src/components/RunnerList.tsx, packages/dashboard/src/components/RunnerSetup.tsx, packages/dashboard/src/components/SparklineChart.tsx, packages/dashboard/src/components/StatusBar.tsx, packages/dashboard/src/components/SystemInfo.tsx, packages/dashboard/src/components/WorkflowDetail.tsx, packages/dashboard/src/components/WorkflowList.tsx, packages/dashboard/src/components/WorkflowsPage.tsx, packages/dashboard/src/hooks/useApi.ts, packages/dashboard/src/hooks/useWebSocket.ts, packages/dashboard/src/main.tsx, packages/dashboard/src/types.ts, packages/dashboard/vite-mock-plugin.ts, packages/dashboard/vite.config.ts, packages/iso/build-iso.ts, packages/iso/collect.ts, packages/setup/src/installer.ts, packages/shared/src/**tests**/protocol.test.ts, packages/shared/src/ipc-client.ts, packages/web/src/**tests**/ws-auth.test.ts, packages/web/src/crypto.ts, packages/web/src/main.ts, packages/web/src/routes/auth.ts, packages/web/src/routes/ws-status.ts, packages/web/src/workflows/**tests**/provision-runner.test.ts, tests/e2e/benchmark-lifecycle.test.ts
  Stats: 60 files changed, 820 insertions(+), 443 deletions(-)

- Updated dependencies [[`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb), [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c)]:
  - @noron/shared@0.1.1
