---
"@noron/web": patch
---

> Branch: fix-perf-pass
> PR: https://github.com/thejustinwalsh/noron/pull/15

- New `src/version.ts` module: reads version from `/var/lib/bench/version` at startup (falls back to `NORON_VERSION` env var, then `"dev"`) — `NORON_VERSION` constant is now shared from one place
- Update integrity check switched from downloading a sidecar `.sha256` file to using GitHub's API-computed `digest` field on the release asset — eliminates a network round-trip and removes the sidecar file requirement
- `GitHubAsset` interface now includes `digest?: string` (GitHub format: `"sha256:<hex>"`)
- Rollback failure: logs exit code + stderr to the server console and audit log; API response no longer exposes internal command output
- Workflow run history capped at 20 entries (down from 100)

Centralises version resolution and hardens the self-update integrity path.
