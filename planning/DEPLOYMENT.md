# Noron Deployment Guide

Full guide to push to GitHub, configure CI, deploy to an Orange Pi appliance, and run benchmarks.

---

## Phase 1: Push to GitHub

### 1a. Ensure the reusable workflows repo is up

The release and changeset workflows reference `thejustinwalsh/workflows/*@main`. Verify it's pushed:

```bash
cd ~/Developer/workflows
git remote -v  # should point to thejustinwalsh/workflows
git push -u origin main
```

### 1b. Create and push the noron repo

```bash
gh repo create thejustinwalsh/noron --private
```

```bash
cd ~/Developer/benchmark-action-runner
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/thejustinwalsh/noron.git
git push -u origin main
```

---

## Phase 2: GitHub Configuration

### 2a. Repository secrets (Settings > Secrets and variables > Actions)

| Secret | Purpose | How to get it |
|--------|---------|---------------|
| `GITHUB_TOKEN` | Auto-provided by Actions | Already exists, no action needed |
| `COPILOT_PAT` | Optional — enhances changeset descriptions | GitHub PAT with `copilot` scope (can skip) |

### 2b. Create a GitHub OAuth App (for dashboard login)

1. Go to **GitHub Settings > Developer settings > OAuth Apps > New OAuth App**
2. Set:
   - **Application name**: `Noron`
   - **Homepage URL**: `https://noron.tjw.dev`
   - **Authorization callback URL**: `https://noron.tjw.dev/auth/github/callback`
3. Note the **Client ID** and generate a **Client Secret** — needed during appliance setup

### 2c. Generate a runner registration token

Generate this right before provisioning (expires in 1 hour):

```bash
gh api repos/thejustinwalsh/noron/actions/runners/registration-token \
  --method POST --jq '.token'
```

---

## Phase 3: Prepare the Orange Pi

### 3a. Prerequisites

- Debian 12 (Bookworm) or Armbian installed
- SSH access as root (or a user with sudo)
- Network connectivity (Ethernet recommended)
- Note the IP address: `ip addr show`

### 3b. Option A: Build locally and deploy (first deploy, no releases yet)

Build the arm64 binaries:

```bash
cd ~/Developer/benchmark-action-runner
bun install
BUN_TARGET=bun-linux-arm64 NORON_VERSION=0.1.0 bun run build
make collect-dist ARCH=arm64
```

Copy to the Orange Pi:

```bash
scp -r packages/iso/dist/* root@<orange-pi-ip>:/tmp/noron-dist/
```

On the Orange Pi, install binaries and run setup:

```bash
ssh root@<orange-pi-ip>

# Install binaries
cp /tmp/noron-dist/benchd/benchd /usr/local/bin/benchd
cp /tmp/noron-dist/bench-exec/bench-exec /usr/local/bin/bench-exec
cp /tmp/noron-dist/web/bench-web /usr/local/bin/bench-web
cp /tmp/noron-dist/setup/bench-setup /usr/local/bin/bench-setup
chmod +x /usr/local/bin/bench*

# Copy hooks
mkdir -p /usr/local/share/bench/hooks
cp /tmp/noron-dist/benchd/hooks/* /usr/local/share/bench/hooks/
chmod +x /usr/local/share/bench/hooks/*

# Copy runner image files
mkdir -p /usr/local/share/bench/runner
cp /tmp/noron-dist/runner-image/* /usr/local/share/bench/runner/

# Copy dashboard
mkdir -p /usr/local/share/bench/dashboard
cp -r /tmp/noron-dist/dashboard/* /usr/local/share/bench/dashboard/

# Run the setup wizard
bench-setup
```

---

## Phase 4: Setup Wizard

The `bench-setup` TUI walks through:

1. **CPU core allocation** — Detects CPU topology. Core 0 = housekeeping (OS, daemon, web). Remaining cores = isolated for benchmarks. On a typical 4-core Orange Pi: cores 1-3 for benchmarks.

2. **GitHub OAuth credentials** — Enter the Client ID and Client Secret from Phase 2b.

3. **Network** — Optionally configure Tailscale for remote access.

4. **Install** — The wizard will:
   - Install system packages (podman, sqlite3, lm-sensors, etc.)
   - Create `bench` and `runner` system users
   - Write `/etc/benchd/config.toml`
   - Install systemd units (benchd, bench-web, benchmark.slice, tuning services)
   - Configure kernel boot params (`isolcpus`, `nohz_full`, `rcu_nocbs`, `nosmt`)
   - Build the Podman runner container image
   - Start services

5. **Reboot** — Required for kernel isolation params to take effect.

```bash
reboot
```

---

## Phase 5: Provision the GitHub Actions Runner

After reboot, verify services:

```bash
systemctl status benchd bench-web
```

Open the dashboard at `https://noron.tjw.dev` (or `http://<orange-pi-ip>:9216` directly) and use the bootstrap invite URL printed during setup. Replace the hostname/port in the invite URL with `https://noron.tjw.dev` if accessing via the tunnel.

**Provision the runner via dashboard**, or manually:

```bash
# Generate a fresh runner token (expires in 1 hour)
RUNNER_TOKEN=$(gh api repos/thejustinwalsh/noron/actions/runners/registration-token \
  --method POST --jq '.token')

# Provision via runner-ctl
sudo runner-ctl provision bench1 thejustinwalsh/noron "$RUNNER_TOKEN"
```

**Verify the runner registered:**

```bash
gh api repos/thejustinwalsh/noron/actions/runners --jq '.runners[] | {name, status, labels}'
```

You should see a runner named `bench1` with labels `self-hosted` and `noron`, status `online`.

---

## Phase 6: Run the Benchmarks

The `benchmark.yml` workflow targets runners with label `[self-hosted, noron]`.

**Trigger manually:**

```bash
gh workflow run "Benchmark Stability" --repo thejustinwalsh/noron
```

Or wait for the weekly Monday 6am UTC schedule.

**What happens per Noron benchmark run:**

1. Job picked up by the Orange Pi runner
2. `job-started` hook → acquires machine-wide lock, writes job token
3. The noron action (`./packages/action`) kicks in:
   - `action.checkin` to benchd
   - Thermal wait — CPU temp must drop below 45°C
   - Prepares cgroup isolation
   - Runs: `sudo bench-exec --cores 1,2,3 --nice -20 --ionice 1 -- bun run packages/benchmark/src/bench.ts`
4. `job-completed` hook → releases lock
5. Results uploaded as artifacts

**Monitor** at `https://noron.tjw.dev` — shows lock status, thermal readings, active jobs.

---

## Phase 7: Verify Isolation

After the benchmark workflow completes, download the report:

```bash
gh run download --repo thejustinwalsh/noron -n benchmark-report
open benchmark-report.html
```

The report compares GitHub-hosted vs Noron runner results:
- **GitHub-hosted**: High variance (typically 5-15% CoV)
- **Noron**: Low variance (target <0.1% CoV)

---

## Networking: Cloudflare Tunnel + Nginx

Traffic flow: `Internet → Cloudflare Tunnel → nginx (local infra) → Orange Pi :9216`

### Cloudflare Tunnel

In the Cloudflare Zero Trust dashboard, add a public hostname to your existing tunnel:

| Field | Value |
|-------|-------|
| Subdomain | `noron` |
| Domain | `tjw.dev` |
| Type | `HTTP` |
| URL | `nginx-host:443` (or `nginx-host:80` if terminating TLS at Cloudflare) |

If using `cloudflared` config file (`~/.cloudflared/config.yml`), add:

```yaml
ingress:
  - hostname: noron.tjw.dev
    service: http://localhost:80  # or https://localhost:443 if nginx has TLS
  # ... existing rules ...
  - service: http_status:404
```

Restart cloudflared after changes: `sudo systemctl restart cloudflared`

### Nginx configuration

Create `/etc/nginx/sites-available/noron.tjw.dev`:

```nginx
server {
    listen 80;
    server_name noron.tjw.dev;

    location / {
        proxy_pass http://<orange-pi-ip>:9216;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (for live status updates)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Longer timeouts for WebSocket connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/noron.tjw.dev /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> **Note**: TLS is terminated by Cloudflare. The tunnel sends traffic to nginx over the local network, so plain HTTP between cloudflared and nginx is fine. Cloudflare handles the `https://noron.tjw.dev` certificate automatically.

### bench-web PUBLIC_URL

Set `PUBLIC_URL=https://noron.tjw.dev` in the bench-web environment so OAuth redirects and invite URLs use the correct external hostname. Either:

- Set it in `/etc/benchd/config.toml` during setup, or
- Edit the systemd unit override:

```bash
sudo systemctl edit bench-web
```

```ini
[Service]
Environment=PUBLIC_URL=https://noron.tjw.dev
```

```bash
sudo systemctl restart bench-web
```

### DNS (Cloudflare manages this)

Cloudflare Tunnel automatically handles DNS — the tunnel creates a CNAME for `noron.tjw.dev` pointing to your tunnel. No manual DNS records needed.

### Verify the full chain

```bash
# From anywhere with internet access
curl -s https://noron.tjw.dev/health
# Should return a 200 with health status from bench-web
```

---

## Quick Reference: Key Paths on the Appliance

| Path | Purpose |
|------|---------|
| `/etc/benchd/config.toml` | Daemon configuration |
| `/var/run/benchd.sock` | IPC Unix socket |
| `/var/lib/bench/bench.db` | Dashboard database |
| `/var/lib/bench/dashboard/` | Dashboard static assets |
| `/usr/local/bin/benchd` | Daemon binary |
| `/usr/local/bin/bench-exec` | Privileged executor |
| `/usr/local/bin/bench-web` | API + dashboard server |
| `/usr/local/lib/benchd/hooks/` | Job lifecycle hooks |
| `/opt/runner/` | Podman runner container files |
| `/mnt/bench-tmpfs/` | Tmpfs for benchmark I/O isolation |

## Troubleshooting

```bash
# Check daemon logs
journalctl -u benchd -f

# Check web server logs
journalctl -u bench-web -f

# Verify CPU isolation took effect after reboot
cat /proc/cmdline | grep isolcpus

# Check thermal readings
sensors

# Check runner container status
sudo runner-ctl status bench1
podman logs bench-bench1

# Re-generate runner token if expired
gh api repos/thejustinwalsh/noron/actions/runners/registration-token \
  --method POST --jq '.token'
```
