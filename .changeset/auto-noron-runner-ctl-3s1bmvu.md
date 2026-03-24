---
"@noron/runner-ctl": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**New package: `runner-ctld` IPC daemon**

- Replaces the shell-based `runner-ctl.sh` with a typed TypeScript IPC daemon (`runner-ctld`) that communicates over a Unix socket
- Handles `provision`, `deprovision`, and token-management requests from `bench-web`
- Runner containers now launched with all CPU cores in `--cpuset-cpus` (bench-exec enforces core isolation independently) and with `--cap-add=SYS_NICE` and `--cap-add=SYS_ADMIN` capabilities

The previous `runner-ctl.sh` script has been removed; `runner-ctld` is the sole runner lifecycle manager.
