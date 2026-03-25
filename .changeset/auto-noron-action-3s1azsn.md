---
"@noron/action": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Default `BENCHD_SOCKET` fallback updated to `/run/benchd/benchd.sock`
- Added `splitCommand()` to correctly tokenize quoted arguments (handles single and double quotes) — fixes commands with spaces inside quoted strings being split incorrectly
- `bench-exec` arguments now use `splitCommand()` instead of naive `.split(" ")`

## BREAKING CHANGES

- Default socket path is now `/run/benchd/benchd.sock`; set `BENCHD_SOCKET` if deploying alongside an older daemon still using `/var/run/benchd.sock`

Fixes argument tokenization for benchmark commands containing quoted strings, and aligns the default socket path with the new `RuntimeDirectory`-based location.
