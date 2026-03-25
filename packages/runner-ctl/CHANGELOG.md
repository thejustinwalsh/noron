# @noron/runner-ctl

## 0.3.1

### Patch Changes

- [#11](https://github.com/thejustinwalsh/noron/pull/11) [`5101300`](https://github.com/thejustinwalsh/noron/commit/5101300fe81fff57b5a14bca3c73e2bb1317d705) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-security-audit-2

  > PR: https://github.com/thejustinwalsh/noron/pull/11

  Socket path and container volume fix:

  - Default benchd socket path updated from `/var/run/benchd.sock` to `/run/benchd/benchd.sock`
  - Runner container now mounts the socket's parent directory (`/run/benchd`) instead of the socket file itself, fixing volume mount failures when the socket is recreated between runs

  Capability reduction:

  - Runner container capability changed from `SYS_ADMIN` to `CAP_PERFMON`; removes unnecessary privilege while retaining perf event access
  - Removed unused `escapeEnvValue` helper

  These commits correct the container volume mount strategy and reduce the runner container's Linux capabilities to the minimum required.

- Updated dependencies [[`3be0e74`](https://github.com/thejustinwalsh/noron/commit/3be0e74ba45268693c27eddb5a0734e039622e62)]:
  - @noron/shared@0.3.1

## 0.3.0

### Minor Changes

- [#9](https://github.com/thejustinwalsh/noron/pull/9) [`d3056b4`](https://github.com/thejustinwalsh/noron/commit/d3056b40f93ef6052d7ea85f9291164d3eddb46d) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-runner-auth-flow

  > PR: https://github.com/thejustinwalsh/noron/pull/9

  **New package — `@noron/runner-ctl`**

  - Introduces `runner-ctld`: a privileged Unix socket daemon that manages GitHub Actions runner container lifecycle on behalf of `benchd`
  - IPC handlers: `provision` (start container), `deprovision` (stop and remove container), `status` (query container state)

  **Container provisioning**

  - Runner containers launched with all CPU cores in the cpuset (housekeeping + isolated) so the runner process and perf can see the full topology
  - `SYS_NICE` and `SYS_ADMIN` capabilities added to containers (required for `taskset` and perf hardware counters)
  - Environment variables written to per-runner env files and mounted into the container

  **Input validation**

  - Runner name: alphanumeric, dashes, and dots only; rejects path traversal and shell metacharacters
  - Repo: must match `owner/repo` format; rejects newlines and shell metacharacters
  - Label: alphanumeric and dashes only

  Introduces the runner-ctld daemon as the privileged boundary for container operations, with strict input validation and comprehensive test coverage.

### Patch Changes

- Updated dependencies [[`d3056b4`](https://github.com/thejustinwalsh/noron/commit/d3056b40f93ef6052d7ea85f9291164d3eddb46d)]:
  - @noron/shared@0.3.0
