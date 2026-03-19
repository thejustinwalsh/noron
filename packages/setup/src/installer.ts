import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { SetupConfig } from "./generate";
import {
	generateBenchWebService,
	generateBenchdConfig,
	generateBenchdService,
	generateBenchmarkSlice,
	generateCpuGovernorService,
	generateDisableTurboService,
	generateGrubAppend,
	generateIrqPinScript,
	generateIrqPinService,
	generateSudoersConfig,
	generateSysctlConfig,
	generateTmpfsMount,
	recommendTmpfsSize,
} from "./generate";

export interface InstallStep {
	name: string;
	status: "pending" | "running" | "done" | "error";
	error?: string;
}

type ProgressCallback = (step: string, status: InstallStep["status"], error?: string) => void;

function run(cmd: string): void {
	execSync(cmd, { stdio: "pipe" });
}

function ensureDir(path: string): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

/** Detect CPU architecture for boot loader handling. */
function isArm(): boolean {
	try {
		const arch = execSync("uname -m", { encoding: "utf-8" }).trim();
		return arch === "aarch64" || arch.startsWith("arm");
	} catch {
		return false;
	}
}

export async function runInstall(
	config: SetupConfig,
	onProgress: ProgressCallback,
): Promise<{ needsReboot: boolean; inviteUrl: string | null }> {
	let needsReboot = false;

	// 1. Install OS packages
	onProgress("Installing system packages", "running");
	try {
		run("apt-get update -qq");
		run(
			"apt-get install -y -qq podman sqlite3 lm-sensors cpufrequtils util-linux sudo htop curl ca-certificates openssh-server",
		);
		onProgress("Installing system packages", "done");
	} catch (err) {
		onProgress("Installing system packages", "error", String(err));
	}

	// 1b. Configure thermal sensors
	onProgress("Configuring thermal sensors", "running");
	try {
		// sensors-detect auto-mode writes modprobe configs for detected sensors
		run("yes | sensors-detect --auto 2>/dev/null || true");
		onProgress("Configuring thermal sensors", "done");
	} catch (err) {
		onProgress("Configuring thermal sensors", "error", String(err));
	}

	// 1c. Disable irqbalance (conflicts with our IRQ pinning)
	onProgress("Disabling irqbalance", "running");
	try {
		run("systemctl stop irqbalance 2>/dev/null || true");
		run("systemctl disable irqbalance 2>/dev/null || true");
		run("systemctl mask irqbalance 2>/dev/null || true");
		onProgress("Disabling irqbalance", "done");
	} catch (err) {
		onProgress("Disabling irqbalance", "error", String(err));
	}

	// 2. Create system users
	onProgress("Creating system users", "running");
	try {
		try {
			run("useradd -r -s /usr/sbin/nologin bench");
		} catch {
			/* user may exist */
		}
		try {
			run("useradd -r -s /bin/bash -G bench runner");
		} catch {
			/* user may exist */
		}
		ensureDir("/var/lib/bench");
		run("chown bench:bench /var/lib/bench");
		onProgress("Creating system users", "done");
	} catch (err) {
		onProgress("Creating system users", "error", String(err));
	}

	// 3. Write config files
	onProgress("Writing configuration", "running");
	try {
		ensureDir("/etc/benchd");
		writeFileSync("/etc/benchd/config.toml", generateBenchdConfig(config));
		chmodSync("/etc/benchd/config.toml", 0o640);
		writeFileSync("/etc/sysctl.d/99-benchmark.conf", generateSysctlConfig());
		run("sysctl --system -q");
		onProgress("Writing configuration", "done");
	} catch (err) {
		onProgress("Writing configuration", "error", String(err));
	}

	// 4. Write systemd units
	onProgress("Installing systemd services", "running");
	try {
		writeFileSync("/etc/systemd/system/benchd.service", generateBenchdService());
		writeFileSync("/etc/systemd/system/benchmark.slice", generateBenchmarkSlice(config));
		writeFileSync("/etc/systemd/system/bench-web.service", generateBenchWebService(config));
		writeFileSync("/etc/systemd/system/bench-irq-pin.service", generateIrqPinService(config));
		writeFileSync("/etc/systemd/system/bench-tuning.service", generateDisableTurboService());
		writeFileSync("/etc/systemd/system/bench-cpu-governor.service", generateCpuGovernorService());

		// Tmpfs mount unit for benchmark I/O isolation (LLVM guideline)
		// Size based on available RAM — skip entirely on low-memory devices
		const tmpfsSize = recommendTmpfsSize(config.totalMemoryMB);
		if (tmpfsSize) {
			const tmpfsPath = "/mnt/bench-tmpfs";
			const unitName = tmpfsPath.slice(1).replace(/\//g, "-"); // mnt-bench-tmpfs
			writeFileSync(
				`/etc/systemd/system/${unitName}.mount`,
				generateTmpfsMount(tmpfsPath, tmpfsSize),
			);
			ensureDir(tmpfsPath);
		}

		run("systemctl daemon-reload");
		onProgress("Installing systemd services", "done");
	} catch (err) {
		onProgress("Installing systemd services", "error", String(err));
	}

	// 5. Write helper scripts
	onProgress("Installing helper scripts", "running");
	try {
		// IRQ pin script
		writeFileSync("/usr/local/bin/pin-irqs", generateIrqPinScript(config));
		chmodSync("/usr/local/bin/pin-irqs", 0o755);

		// Disable turbo boost script
		writeFileSync(
			"/usr/local/bin/disable-turbo",
			"#!/bin/bash\necho 1 > /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || true\n# ARM: disable boost via cpufreq\necho 0 > /sys/devices/system/cpu/cpufreq/boost 2>/dev/null || true\n",
		);
		chmodSync("/usr/local/bin/disable-turbo", 0o755);

		// Disable THP script
		writeFileSync(
			"/usr/local/bin/disable-thp",
			"#!/bin/bash\necho never > /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || true\necho never > /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || true\n",
		);
		chmodSync("/usr/local/bin/disable-thp", 0o755);

		// Sudoers
		writeFileSync("/etc/sudoers.d/bench-exec", generateSudoersConfig());
		chmodSync("/etc/sudoers.d/bench-exec", 0o440);

		onProgress("Installing helper scripts", "done");
	} catch (err) {
		onProgress("Installing helper scripts", "error", String(err));
	}

	// 6. Copy dashboard assets
	onProgress("Installing dashboard", "running");
	try {
		ensureDir("/var/lib/bench/dashboard");
		if (existsSync("/usr/local/share/bench/dashboard")) {
			run("cp -r /usr/local/share/bench/dashboard/* /var/lib/bench/dashboard/");
		} else {
			// Try the dist directory next to the setup binary
			const altPath = `${import.meta.dir}/../../../dashboard/dist`;
			if (existsSync(altPath)) {
				run(`cp -r ${altPath}/* /var/lib/bench/dashboard/`);
			}
		}
		onProgress("Installing dashboard", "done");
	} catch (err) {
		onProgress("Installing dashboard", "error", String(err));
	}

	// 7. Install runner infrastructure (hooks, runner-ctl, Podman image)
	onProgress("Installing runner infrastructure", "running");
	try {
		// Create directories
		ensureDir("/opt/runner/envs");
		ensureDir("/usr/local/lib/benchd/hooks");

		// Copy hook binaries (compiled alongside setup binary)
		const hookSources = ["/usr/local/share/bench/hooks", `${import.meta.dir}/../../../hooks`];
		for (const hookDir of hookSources) {
			if (existsSync(`${hookDir}/job-started`)) {
				run(`cp ${hookDir}/job-started /usr/local/lib/benchd/hooks/job-started`);
				chmodSync("/usr/local/lib/benchd/hooks/job-started", 0o755);
				run(`cp ${hookDir}/job-completed /usr/local/lib/benchd/hooks/job-completed`);
				chmodSync("/usr/local/lib/benchd/hooks/job-completed", 0o755);
				break;
			}
		}

		// Copy Containerfile + start.sh
		const runnerSources = [
			"/usr/local/share/bench/runner",
			`${import.meta.dir}/../../../runner-image`,
		];
		for (const src of runnerSources) {
			if (existsSync(`${src}/Containerfile`)) {
				run(`cp ${src}/Containerfile /opt/runner/Containerfile`);
				run(`cp ${src}/start.sh /opt/runner/start.sh`);
				chmodSync("/opt/runner/start.sh", 0o755);
				break;
			}
		}

		// Install runner-ctl
		const ctlSources = [
			"/usr/local/share/bench/runner-ctl.sh",
			`${import.meta.dir}/../../../runner-image/runner-ctl.sh`,
		];
		for (const src of ctlSources) {
			if (existsSync(src)) {
				run(`cp ${src} /usr/local/bin/runner-ctl`);
				chmodSync("/usr/local/bin/runner-ctl", 0o755);
				break;
			}
		}

		// Build Podman image (may take a few minutes)
		if (existsSync("/opt/runner/Containerfile")) {
			const runnerArch = isArm() ? "arm64" : "x64";
			run(`podman build --build-arg RUNNER_ARCH=${runnerArch} -t bench-runner /opt/runner/`);
		}

		onProgress("Installing runner infrastructure", "done");
	} catch (err) {
		onProgress("Installing runner infrastructure", "error", String(err));
	}

	// 8. Configure boot loader for CPU isolation
	onProgress("Configuring boot parameters", "running");
	try {
		if (config.isolatedCores.length > 0) {
			const grubDefault = "/etc/default/grub";
			if (existsSync(grubDefault) && !isArm()) {
				// x86: update GRUB
				const append = generateGrubAppend(config);
				let grub = readFileSync(grubDefault, "utf-8");
				grub = grub.replace(
					/^GRUB_CMDLINE_LINUX_DEFAULT=.*/m,
					`GRUB_CMDLINE_LINUX_DEFAULT="quiet ${append}"`,
				);
				writeFileSync(grubDefault, grub);
				run("update-grub");
				needsReboot = true;
			} else if (isArm()) {
				// ARM: update /boot/cmdline.txt or /boot/firmware/cmdline.txt
				const append = generateGrubAppend(config);
				const cmdlinePaths = ["/boot/firmware/cmdline.txt", "/boot/cmdline.txt"];
				for (const cmdlinePath of cmdlinePaths) {
					if (existsSync(cmdlinePath)) {
						let cmdline = readFileSync(cmdlinePath, "utf-8").trim();
						// Remove any existing isolcpus/nohz_full/rcu_nocbs params
						cmdline = cmdline.replace(/\s*isolcpus=\S*/g, "");
						cmdline = cmdline.replace(/\s*nohz_full=\S*/g, "");
						cmdline = cmdline.replace(/\s*rcu_nocbs=\S*/g, "");
						cmdline = cmdline.replace(/\s*nosmt\b/g, "");
						cmdline = `${cmdline.trim()} ${append}`;
						writeFileSync(cmdlinePath, `${cmdline}\n`);
						needsReboot = true;
						break;
					}
				}
			}
		}
		onProgress("Configuring boot parameters", "done");
	} catch (err) {
		onProgress("Configuring boot parameters", "error", String(err));
	}

	// 8. Create bootstrap invite (before bench-web starts so it finds the existing DB)
	let inviteUrl: string | null = null;
	onProgress("Creating bootstrap invite", "running");
	try {
		const dbPath = "/var/lib/bench/bench.db";
		const token = crypto.randomUUID();
		const now = Date.now();
		const expiresAt = now + 7 * 24 * 3600_000; // 7 days
		// Use sqlite3 CLI to create the invite — avoids pulling bun:sqlite into the setup binary
		run(
			`sqlite3 "${dbPath}" "CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT)"`,
		);
		run(
			`sqlite3 "${dbPath}" "INSERT INTO invites (id, token, created_at, expires_at) VALUES ('${crypto.randomUUID()}', '${token}', ${now}, ${expiresAt})"`,
		);
		run(`chown bench:bench "${dbPath}"`);
		chmodSync(dbPath, 0o640);
		const baseUrl = `http://${config.hostname}:${config.webPort}`;
		inviteUrl = `${baseUrl}/invite/${token}`;
		onProgress("Creating bootstrap invite", "done");
	} catch (err) {
		onProgress("Creating bootstrap invite", "error", String(err));
	}

	// 9. Enable and start services
	onProgress("Starting services", "running");
	try {
		// Mount tmpfs if configured (skipped on low-memory devices)
		if (recommendTmpfsSize(config.totalMemoryMB)) {
			run("systemctl enable --now mnt-bench\\x2dtmpfs.mount");
		}
		// CPU tuning services (oneshot)
		run("systemctl enable --now bench-irq-pin");
		run("systemctl enable --now bench-tuning");
		run("systemctl enable --now bench-cpu-governor");
		// Core services
		run("systemctl enable --now benchd");
		run("systemctl enable --now bench-web");
		onProgress("Starting services", "done");
	} catch (err) {
		onProgress("Starting services", "error", String(err));
	}

	// 10. Optional: Tailscale
	if (config.tailscaleAuthKey) {
		onProgress("Setting up Tailscale", "running");
		try {
			if (!existsSync("/usr/bin/tailscale")) {
				run("curl -fsSL https://tailscale.com/install.sh | sh");
			}
			run(`tailscale up --authkey=${config.tailscaleAuthKey} --hostname=bench-${config.hostname}`);
			run(`tailscale funnel --bg ${config.webPort}`);
			onProgress("Setting up Tailscale", "done");
		} catch (err) {
			onProgress("Setting up Tailscale", "error", String(err));
		}
	}

	return { needsReboot, inviteUrl };
}
