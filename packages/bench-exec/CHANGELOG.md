# @noron/bench-exec

## 0.3.0

### Patch Changes

- [#9](https://github.com/thejustinwalsh/noron/pull/9) [`d3056b4`](https://github.com/thejustinwalsh/noron/commit/d3056b40f93ef6052d7ea85f9291164d3eddb46d) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-runner-auth-flow

  > PR: https://github.com/thejustinwalsh/noron/pull/9

  **perf stat privilege flow**

  - perf now runs as root (required for hardware counters) and drops privileges for the benchmark subprocess only, using `sudo -u $SUDO_USER -- env KEY=VAL …` rather than `sudo --preserve-env`
  - Switched from `--preserve-env` to explicit `env KEY=VALUE` args to bypass sudoers `env_reset` on systems where the root rule lacks `SETENV`
  - `BENCH_OUTPUT`, `BENCH_RUNNER`, `BENCH_RUN_INDEX`, `TMPDIR`, and `BENCH_TMPFS` are now reliably passed through to the benchmark process

  **Isolation health check**

  - `isolationHealthy` now only requires zero CPU migrations; context-switch count no longer checked

  These fixes resolve environment-variable stripping under Debian's default sudoers `env_reset` policy when perf stat is used.

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

### Minor Changes

- [#3](https://github.com/thejustinwalsh/noron/pull/3) [`65fe7dd`](https://github.com/thejustinwalsh/noron/commit/65fe7dd4fb8be30796f809584e65b50d029bd811) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-runner-update

  > PR: https://github.com/thejustinwalsh/noron/pull/3

  ## Changes

  - Added `--perf-stat` flag: wraps the user command in `perf stat -d -x \t`, collecting hardware performance counters without affecting benchmark output
  - Added `--perf-stat-output <path>` flag: destination for the raw TSV data (default `/tmp/bench-perf-stat.tsv`)
  - After benchmark exit, parses the TSV and writes a `.json` sidecar with structured fields: `ipc`, `contextSwitches`, `cpuMigrations`, `branchMissRate`, `l1MissRate`, `isolationHealthy`
  - Isolation health is `true` when context-switches ≤ 5 and cpu-migrations = 0; summary printed to stderr after each run
  - `--perf-stat` exits with an error if `perf` is not available on the system (`isPerfAvailable()` check)
  - New `perf-stat.ts`: parser (`parsePerfStat`), human-readable formatter (`formatPerfStatSummary`), and availability check (`isPerfAvailable`)
  - New `perf-stat.test.ts`: covers counter parsing, IPC/branch-miss/L1-miss rate derivation, isolation health thresholds, empty input, malformed lines, and comma-formatted numbers
  - `BENCH_SESSION_ID` and `BENCH_JOB_TOKEN` are now stripped from the child environment regardless of `--perf-stat` mode

  Added `perf stat` hardware counter collection to `bench-exec`, enabling isolation health reporting and microarchitectural profiling alongside benchmark execution.

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
