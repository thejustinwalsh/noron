---
"@noron/cli": patch
---

> Branch: fix-update-ui
> PR: https://github.com/thejustinwalsh/noron/pull/13

- New `noron update rollback` command to roll back the appliance to the previously installed version
- Calls `POST /api/update/rollback` on the configured bench-web server; reports the version rolled back from on success

The CLI now supports manual rollback via `noron update rollback`.
