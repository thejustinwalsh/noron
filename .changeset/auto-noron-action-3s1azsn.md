---
"@noron/action": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

**Security audit and bug fixes**

- Fixed benchmark command parsing: replaced naive `.split(" ")` with `splitCommand()`, which correctly handles single/double-quoted arguments and arguments with spaces
- Added unit tests for `splitCommand()` covering quotes, mixed whitespace, and empty input

Fixes command parsing for benchmark scripts whose arguments contain spaces or shell-quoted tokens.
