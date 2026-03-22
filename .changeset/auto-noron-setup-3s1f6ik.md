---
"@noron/setup": patch
---

> Branch: refactor-disk-image-flow
> PR: https://github.com/thejustinwalsh/noron/pull/2

- New `Password` wizard step: prompts for and sets the `bench` user password (min 6 chars, confirmation required) during first-run setup
- New `Timezone` wizard step: interactive search with `timedatectl`; accepts current timezone on empty Enter, exact or unique-prefix match on typed input
- Wizard flow: first run now goes `welcome → password → timezone → cores → ...`; `--reconfigure` skips password and timezone steps
- `--reconfigure` flag: re-runs the full installer without creating a new bootstrap invite or resetting existing users
- Install step: live subprocess output shown in a 3-line scrolling panel in the TUI during long operations (apt, podman build, Tailscale install)
- Done step: interactive reboot prompt (`y/n`) replaces the previous static "run sudo reboot" message
- Installer: tuning services (`bench-irq-pin`, `bench-tuning`, `bench-cpu-governor`, tmpfs mount) tolerate start failures in containers/VMs; core services (`benchd`, `bench-web`) still required
- Installer: `bench` user created via `adduser` with sudo group membership; sudo access removed after setup (scoped sudoers rules provide the required access)
- Installer: `/etc/benchd` created with `root:bench:770`; config files owned `root:bench`
- Installer: `/var/lib/bench/.setup-complete` written by the installer itself (not by systemd's `ExecStartPost`)
- Bootstrap invite only created on first run; reconfigure preserves the existing database and users
- `runAsync` helper exported for running subprocesses without blocking Ink's render loop
- Tests: new `installer.test.ts` covering sudoers rule generation and first-run vs reconfigure branching

BREAKING CHANGES: `bench-setup --reconfigure` is the new entry point for re-running setup; invoking without the flag on an already-set-up machine is a no-op.

Significantly improves the setup experience with a guided first-run flow, live install progress, and safe reconfigure support.
