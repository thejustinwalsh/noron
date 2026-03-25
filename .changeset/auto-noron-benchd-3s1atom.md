---
"@noron/benchd": patch
---

> Branch: fix-update-ui
> PR: https://github.com/thejustinwalsh/noron/pull/13

- `CgroupManager.ensureSubtreeControl()` now always re-applies cgroup subtree control on every call instead of skipping after the first successful write; prevents stale cgroup configuration after `benchd` service restarts

Cgroup subtree control is now reliably re-applied across service restarts, preventing silent failures when the benchmark slice loses its controller configuration.
