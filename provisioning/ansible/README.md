# Ansible Deployment

Provision one or more Debian 12 machines as Noron benchmark appliances using Ansible. This is the recommended approach for managing fleets of benchmark runners or automating repeatable deployments.

For single-machine deployments, the [bootable ISO](../../packages/iso/README.md) with its interactive setup wizard is easier.

## Prerequisites

- [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/) 2.14+ installed on your control machine
- Target machine(s) running Debian 12 (bookworm) with SSH access as root
- A GitHub OAuth App ([create one](https://github.com/settings/developers))

## Quick start

```bash
cd provisioning/ansible

# 1. Edit the inventory with your machine(s)
cp inventory.yml inventory.local.yml
vim inventory.local.yml

# 2. Configure variables for your deployment
cp group_vars/all.yml group_vars/all.local.yml
vim group_vars/all.local.yml

# 3. Create a vault for secrets
ansible-vault create group_vars/vault.yml
# Add:
#   vault_tailscale_auth_key: "tskey-..."
#   vault_github_client_id: "Iv1.abc123"
#   vault_github_client_secret: "secret..."

# 4. Run the playbook
ansible-playbook -i inventory.local.yml playbook.yml --ask-vault-pass
```

## Inventory

Define your target machines in `inventory.yml`:

```yaml
all:
  hosts:
    # Orange Pi 5 on the local network
    bench-opi5:
      ansible_host: 192.168.1.100
      ansible_user: root

    # Chromebox in the server closet
    bench-chromebox:
      ansible_host: 192.168.1.101
      ansible_user: root

    # Cloud VM
    bench-cloud:
      ansible_host: bench-vm.example.com
      ansible_user: root
```

## Variables

Configure your deployment in `group_vars/all.yml`:

```yaml
# CPU core allocation — adjust per machine or use host_vars/
isolated_cores: "1,2,3"       # cores dedicated to benchmarks
housekeeping_core: "0"         # core for OS, daemon, web

# System users (created by the base role)
benchmark_user: "bench"
runner_user: "runner"

# Daemon
benchd_socket: "/var/run/benchd.sock"

# Tmpfs for benchmark I/O (LLVM guideline: avoid disk variance)
bench_tmpfs_path: "/mnt/bench-tmpfs"
bench_tmpfs_size: "4g"

# GitHub (org that owns the runner repos)
github_org: "your-org"

# Web dashboard
web_port: 9216
github_client_id: "{{ vault_github_client_id }}"
github_client_secret: "{{ vault_github_client_secret }}"

# Tailscale VPN (optional — remove tailscale role from playbook if not using)
tailscale_auth_key: "{{ vault_tailscale_auth_key }}"
```

For machines with different CPU counts, use `host_vars/`:

```yaml
# host_vars/bench-opi5.yml
isolated_cores: "4,5,6,7"     # pin to the A76 (big) cores on RK3588
housekeeping_core: "0"
```

## Roles

The playbook runs these roles in order:

| Role | What it does |
|------|-------------|
| **base** | Kernel hardening (isolcpus, nohz_full, rcu_nocbs, nosmt), disables turbo boost, THP, and ASLR, pins IRQs to housekeeping core, creates tmpfs, installs system packages |
| **bun** | Installs Bun runtime to /usr/local/bin |
| **benchd** | Deploys benchd, bench-exec, bench-web, hooks, generates config.toml, installs systemd services and benchmark.slice cgroup |
| **runner** | Builds the Podman runner container image, creates systemd service for the GitHub Actions runner with proper socket/volume mounts |
| **tailscale** | Installs and authenticates Tailscale VPN, optionally exposes web dashboard via Tailscale Funnel |

### Skipping roles

Omit Tailscale if you don't need VPN access:

```yaml
# playbook.yml
- name: Provision Benchmark Appliance
  hosts: all
  become: true
  roles:
    - base
    - bun
    - benchd
    - runner
    # - tailscale   # uncomment if using Tailscale
```

## What the playbook does

After a successful run, your machine will have:

1. **Kernel parameters** configured in GRUB for CPU isolation, tickless cores, and RCU offloading
2. **CPU governor** set to `performance` with turbo boost disabled
3. **ASLR and THP disabled** for deterministic benchmark behavior
4. **All IRQs pinned** to the housekeeping core
5. **benchd** running as a systemd service, managing the benchmark lock and thermals
6. **bench-web** serving the dashboard on port 9216
7. **A Podman container** running the GitHub Actions runner, connected to benchd over Unix socket
8. **A tmpfs mount** for benchmark I/O at the configured path

A **reboot is required** after the first run to apply kernel parameters.

## Per-machine core allocation

For heterogeneous hardware (e.g., an Orange Pi 5 with big.LITTLE and a Chromebox with 4 identical cores), use `host_vars/` to customize per machine:

```
provisioning/ansible/
  host_vars/
    bench-opi5.yml          # isolated_cores: "4,5,6,7"
    bench-chromebox.yml     # isolated_cores: "1,2,3"
  group_vars/
    all.yml                 # shared config
    vault.yml               # secrets
  inventory.yml
  playbook.yml
```

## Updating appliances

To update binaries on deployed appliances, either:

1. **Self-update** (recommended) — configure `update_repo` in `/etc/benchd/config.toml` on each appliance. They'll poll GitHub Releases and update themselves. See the [ISO docs](../../packages/iso/README.md#self-updates).

2. **Re-run the playbook** — build new binaries locally, then re-run:
   ```bash
   BUN_TARGET=bun-linux-arm64 bun run collect-dist
   ansible-playbook -i inventory.local.yml playbook.yml --ask-vault-pass --tags benchd,runner
   ```
   The `benchd` and `runner` roles are idempotent — they'll replace binaries and restart services.

## Troubleshooting

**Playbook fails at benchd role:** Ensure binaries are built first (`BUN_TARGET=bun-linux-arm64 bun run collect-dist`). The role copies pre-compiled binaries — it doesn't build from source.

**Runner container won't start:** Check that Podman is installed (`podman --version`) and the benchd socket exists (`ls -la /var/run/benchd.sock`). View logs with `journalctl -u bench-runner`.

**Kernel params not applied:** Reboot after the first playbook run. Verify with `cat /proc/cmdline` — you should see `isolcpus=`, `nohz_full=`, etc.

**Thermal readings unavailable:** Some SBCs need `lm-sensors` configured. Run `sensors-detect` to identify available thermal zones.
