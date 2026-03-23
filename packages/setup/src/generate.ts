import { type BenchdConfig, DEFAULT_CONFIG, serializeToml } from "@noron/shared";

export interface SetupConfig {
	isolatedCores: number[];
	housekeepingCore: number;
	githubClientId: string;
	githubClientSecret: string;
	tailscaleAuthKey?: string;
	webPort: number;
	hostname: string;
	totalMemoryMB: number;
	runnerLabel: string;
}

export function generateBenchdConfig(setup: SetupConfig): string {
	const config: BenchdConfig = {
		...DEFAULT_CONFIG,
		isolatedCores: setup.isolatedCores,
		housekeepingCore: setup.housekeepingCore,
		runnerLabel: setup.runnerLabel,
	};
	return serializeToml(config);
}

export function generateGrubAppend(setup: SetupConfig): string {
	const cores = setup.isolatedCores.join(",");
	return `isolcpus=${cores} nohz_full=${cores} rcu_nocbs=${cores} nosmt`;
}

/** Remove any previous benchmark kernel params from a string. */
function stripBenchParams(s: string): string {
	return s
		.replace(/\s*isolcpus=\S*/g, "")
		.replace(/\s*nohz_full=\S*/g, "")
		.replace(/\s*rcu_nocbs=\S*/g, "")
		.replace(/\s*nosmt\b/g, "")
		.trim();
}

/** Update armbianEnv.txt content with benchmark kernel params. */
export function updateArmbianEnv(content: string, append: string): string {
	if (/^extraargs=/m.test(content)) {
		return content.replace(/^extraargs=(.*)$/m, (_match, existing: string) => {
			const cleaned = stripBenchParams(existing);
			return cleaned ? `extraargs=${cleaned} ${append}` : `extraargs=${append}`;
		});
	}
	return `${content.trimEnd()}\nextraargs=${append}\n`;
}

/** Update cmdline.txt content with benchmark kernel params. */
export function updateCmdline(content: string, append: string): string {
	return `${stripBenchParams(content)} ${append}`;
}

/** Update GRUB_CMDLINE_LINUX_DEFAULT with benchmark kernel params. */
export function updateGrubDefault(content: string, append: string): string {
	return content.replace(
		/^GRUB_CMDLINE_LINUX_DEFAULT=.*/m,
		`GRUB_CMDLINE_LINUX_DEFAULT="quiet ${append}"`,
	);
}

export function generateBenchmarkSlice(setup: SetupConfig): string {
	return `[Unit]
Description=Benchmark CPU Isolation Slice
Before=slices.target

[Slice]
AllowedCPUs=${setup.isolatedCores.join(",")}
AllowedMemoryNodes=0

[Install]
WantedBy=slices.target
`;
}

export function generateBenchdService(): string {
	return `[Unit]
Description=Benchmark Daemon
After=network.target
Wants=benchmark.slice

[Service]
Type=simple
ExecStart=/usr/local/bin/benchd
User=root
Group=root
Restart=on-failure
RestartSec=5

# Pin to housekeeping core — never steal benchmark CPU time
CPUAffinity=0

ProtectSystem=strict
ReadWritePaths=/run /var/run /sys/fs/cgroup/benchmark.slice /sys/devices/system/cpu /etc/benchd
PrivateTmp=true
NoNewPrivileges=false

AmbientCapabilities=CAP_SYS_NICE CAP_SYS_ADMIN
CapabilityBoundingSet=CAP_SYS_NICE CAP_SYS_ADMIN CAP_DAC_OVERRIDE

RuntimeDirectory=benchd
ExecStartPre=/bin/rm -f /var/run/benchd.sock

Environment=BENCHD_SOCKET=/var/run/benchd.sock
Environment=BENCHD_LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
`;
}

export function generateBenchWebService(setup: SetupConfig): string {
	return `[Unit]
Description=Benchmark Web Service
After=network.target benchd.service

[Service]
Type=simple
ExecStart=/usr/local/bin/bench-web
User=bench
Restart=on-failure
RestartSec=5

# Pin to housekeeping core — never steal benchmark CPU time
CPUAffinity=${setup.housekeepingCore}

WorkingDirectory=/var/lib/bench

Environment=PORT=${setup.webPort}
Environment=DATABASE_PATH=/var/lib/bench/bench.db
Environment=WORKFLOW_DB_PATH=/var/lib/bench/workflows.db
Environment=BENCHD_SOCKET=/var/run/benchd.sock
Environment=DASHBOARD_DIR=/var/lib/bench/dashboard
Environment=GITHUB_CLIENT_ID=${setup.githubClientId}
Environment=GITHUB_CLIENT_SECRET=${setup.githubClientSecret}
Environment=PUBLIC_URL=http://${setup.hostname}:${setup.webPort}

ProtectSystem=strict
ReadWritePaths=/var/lib/bench /run /var/run
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

export function generateIrqPinService(setup: SetupConfig): string {
	return `[Unit]
Description=Pin hardware IRQs to housekeeping core
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pin-irqs
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;
}

export function generateDisableTurboService(): string {
	return `[Unit]
Description=Disable CPU turbo boost for benchmark consistency
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/disable-turbo
ExecStart=/usr/local/bin/disable-thp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;
}

export function generateSysctlConfig(): string {
	return `# Benchmark appliance sysctl configuration
# Reference: LLVM Benchmarking Guidelines

kernel.randomize_va_space = 0
kernel.nmi_watchdog = 0
kernel.timer_migration = 0
vm.dirty_ratio = 5
vm.dirty_background_ratio = 1

# Allow userspace access to CPU performance counters (required by @mitata/counters)
kernel.perf_event_paranoid = 2
`;
}

export function generateIrqPinScript(setup: SetupConfig): string {
	return `#!/bin/bash
# Pin all hardware interrupts to housekeeping core
for irq in /proc/irq/*/smp_affinity_list; do
    echo ${setup.housekeepingCore} > "$irq" 2>/dev/null || true
done
echo ${setup.housekeepingCore} > /proc/irq/default_smp_affinity 2>/dev/null || true
`;
}

export function generateSudoersConfig(): string {
	return [
		"runner ALL=(root) NOPASSWD: /usr/local/bin/bench-exec",
		"bench ALL=(root) NOPASSWD: /usr/local/bin/runner-ctl",
		"bench ALL=(root) NOPASSWD: /usr/local/bin/bench-updater",
		"",
	].join("\n");
}

/**
 * Compute tmpfs size based on available system memory.
 * Returns null if memory is too low to safely allocate tmpfs.
 *
 * - < 2GB RAM: no tmpfs (system needs all memory for OS + runner + daemon)
 * - 2-4GB: 512MB tmpfs
 * - 4-8GB: 2GB tmpfs
 * - 8GB+: 4GB tmpfs
 */
export function recommendTmpfsSize(totalMemoryMB: number): string | null {
	if (totalMemoryMB < 2048) return null;
	if (totalMemoryMB < 4096) return "512m";
	if (totalMemoryMB < 8192) return "2g";
	return "4g";
}

export function generateTmpfsMount(path: string, size: string): string {
	return `[Unit]
Description=Benchmark tmpfs for I/O isolation
DefaultDependencies=no

[Mount]
What=tmpfs
Where=${path}
Type=tmpfs
Options=size=${size},mode=1777,noatime,nosuid,nodev

[Install]
WantedBy=local-fs.target
`;
}

export function generateRunnerUpdateService(): string {
	return `[Unit]
Description=Rebuild runner container image
After=network-online.target benchd.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/bench-runner-update
CPUAffinity=0
Nice=19
IOSchedulingClass=idle

[Install]
WantedBy=multi-user.target
`;
}

export function generateRunnerUpdateTimer(): string {
	return `[Unit]
Description=Weekly runner container image rebuild

[Timer]
OnCalendar=Sun 04:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
`;
}

export function generateCpuGovernorService(): string {
	return `[Unit]
Description=Set CPU governor to performance for benchmark consistency
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'for gov in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo performance > "$gov" 2>/dev/null || true; done'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;
}
