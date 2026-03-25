---
"@noron/action": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Fixed command parsing to handle quoted arguments (single and double quotes); previously `command.split(" ")` broke commands with spaces in quoted args
- Extracted `splitCommand` into its own module (`split-command.ts`) for reuse and testability
- Added tests for `splitCommand` covering empty input, tabs, nested quotes, and mixed quotes
- Updated default socket path to `/run/benchd/benchd.sock` (was `/var/run/benchd.sock`)

Security hardening and socket path standardization for the GitHub Action runner integration.
