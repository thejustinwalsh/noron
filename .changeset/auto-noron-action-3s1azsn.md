---
"@noron/action": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Fixed command splitting to use a quote-aware parser (`splitCommand`) instead of `.split(" ")`, preventing incorrect argument splitting when benchmark commands contain quoted arguments with spaces
- Added tests covering simple commands, single/double-quoted args, mixed quotes, tabs, and embedded quote characters

This release fixes a command-injection-adjacent bug where benchmark commands with quoted arguments were split incorrectly, causing execution failures for commands containing spaces.
