---
"@noron/shared": patch
---

> Branch: refactor-disk-image-flow
> PR: https://github.com/thejustinwalsh/noron/pull/2

- Removed `SystemInfo` interface (`isolatedCores`, `housekeepingCore`, `totalCores`) from protocol
- Removed `system?: SystemInfo` field from `StatusUpdate`

BREAKING CHANGES: `StatusUpdate` no longer carries a `system` field. Consumers that read CPU topology from status updates must switch to the config API endpoint.

CPU topology is now served through the dedicated config endpoint rather than being embedded in every status broadcast.
