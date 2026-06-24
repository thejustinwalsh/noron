# CI/CD Workflows

## Overview

```mermaid
graph TD
    push[Push / PR] --> ci[CI]
    pr[PR opened/updated] --> changeset[Generate Changeset]

    ci --> |main branch, passed| release[Release]
    release --> |changesets pending| release_pr[Create Release PR]
    release --> |release PR merged| tag[Tag + Version]
    tag --> build_iso[Build Armbian SBC images]
    build_iso --> gh_release[GitHub Release]

    changeset --> generate[Parse conventional commits]
    generate --> copilot[Enhance with Copilot]
    copilot --> commit[Commit changesets to PR]
```

## Workflows

### `ci.yml` — Continuous Integration

Runs on every push and pull request.

```mermaid
graph LR
    checkout --> typecheck --> lint --> test --> build
```

- **check** job: typecheck, lint, test
- **build** job: compiles all packages (depends on check passing)

### `changeset.yml` — Auto-Generate Changelogs

Runs on PR open/update against `main`.

```mermaid
graph TD
    A[Checkout PR branch] --> B{Last commit from this workflow?}
    B --> |yes| skip[Skip]
    B --> |no| C[Parse conventional commits]
    C --> D[Map changed files to packages]
    D --> E[Determine semver bump per package]
    E --> F[Write .changeset/auto-*.md files]
    F --> G[Copilot CLI reviews git diffs]
    G --> H[Rewrite raw commits into changelog bullets]
    H --> I[Commit and push to PR branch]
```

**Conventional commit mapping:**
- `feat:` = minor, `fix:`/`perf:`/`refactor:` = patch, `!` or `BREAKING CHANGE` = major
- `docs:`/`test:`/`ci:`/`chore:` = skipped (no changeset)

**Copilot enhancement:** The raw changeset contains commit SHAs, file lists, and diff stats. Copilot CLI reads the actual diffs via `git show`, then rewrites the body into concise user-facing changelog entries. This step is `continue-on-error` — if Copilot is unavailable, the raw commit details are kept.

**Requires:** `COPILOT_PAT` secret (GitHub PAT with Copilot access).

### `release.yml` — Release + Armbian Image Build

Runs after CI passes on `main`, or via manual dispatch.

```mermaid
graph TD
    A[CI passes on main] --> B[Release job]
    B --> C{Changesets pending?}
    C --> |yes| D[Create 'chore: release' PR]
    C --> |no, release PR just merged| E[Version bump + git tag]

    E --> F[Build Orange Pi Armbian image]
    E --> G[Build Raspberry Pi Armbian image]
    F --> H[GitHub Release]
    G --> H
    H --> I[Attach Armbian images to release]
```

**Three jobs:**

1. **release** — Uses `changesets/action` which has two modes:
   - If `.changeset/*.md` files exist: creates a "chore: release" PR that bumps versions and updates CHANGELOG.md
   - If that PR was just merged (no changesets left): tags the release and outputs `published=true`

2. **build-sbc** — Triggered when `published=true`. Matrix build for supported Armbian boards:
   - Compiles all Bun binaries for ARM64
   - Collects dist (binaries + hooks + dashboard + runner assets)
   - Validates all image assets present
   - Builds board-specific Armbian images for Orange Pi 5 Plus and Raspberry Pi 4/5

3. **github-release** — Downloads the Armbian image artifacts and creates a GitHub Release with only those public assets attached.

## Secrets Required

| Secret | Used by | Purpose |
|--------|---------|---------|
| `GITHUB_TOKEN` | All workflows | Auto-provided. PR creation, release creation |
| `COPILOT_PAT` | changeset.yml | GitHub PAT with Copilot access for changelog enhancement |

## Release Lifecycle

```mermaid
sequenceDiagram
    participant Dev
    participant PR
    participant CI
    participant Changeset
    participant Release
    participant GitHub

    Dev->>PR: Push feature branch (conventional commits)
    PR->>Changeset: Auto-generate changeset files
    Changeset->>Changeset: Copilot enhances changelog
    Changeset->>PR: Commit changesets to branch
    Dev->>PR: Review and merge
    PR->>CI: Runs typecheck + lint + test + build
    CI->>Release: Triggers on success
    Release->>GitHub: Creates "chore: release" PR
    Dev->>GitHub: Merge release PR
    GitHub->>CI: CI runs on merge
    CI->>Release: Triggers again
    Release->>Release: Tags v0.x.x
    Release->>Release: Builds Armbian SBC images
    Release->>GitHub: Creates GitHub Release with Armbian images
```
