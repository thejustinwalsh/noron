---
"@noron/action": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- `splitCommand` extracted to `packages/action/src/split-command.ts`; `index.ts` now imports it rather than defining it inline
- Default benchd socket path updated from `/var/run/benchd.sock` to `/run/benchd/benchd.sock` (matches XDG/systemd `RuntimeDirectory`)

Security fixes for the GitHub Action:
- Updated test import to reference the new `split-command` module

These commits extract a utility function for improved testability and align the Action's default socket path with the updated system-level convention.
