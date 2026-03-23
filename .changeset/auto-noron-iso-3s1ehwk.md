---
"@noron/iso": minor
---

> Branch: fix-runner-update
> PR: https://github.com/thejustinwalsh/noron/pull/3

## Changes

- `bench-runner-update.sh` is now bundled in ISO, x86 image, and SBC image builds; it was missing from all three image types and is required for the weekly runner update timer
- `linux-perf` and `socat` added to package lists for ISO, x86 img, and SBC builds (required for `perf stat` collection and IPC communication in `bench-runner-update`)
- `collect.ts`: `bench-runner-update.sh` included in the runner-image asset list so it is copied into the distribution archive
- Updated documentation: install step wording changed from "Installs packages" to "Updates packages"

Bundled `bench-runner-update.sh` and its runtime dependencies into all image builds, enabling automated weekly runner container rebuilds on first boot.
