import { execSync, spawn } from "node:child_process";
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
	generateRunnerCtldService,
	generateRunnerUpdateService,
	generateRunnerUpdateTimer,
	generateSudoersConfig,
	generateSysctlConfig,
	generateTmpfsMount,
	recommendTmpfsSize,
	updateArmbianEnv,
	updateCmdline,
	updateGrubDefault,
} from "./generate";

/** Step name constants — single source of truth for installer ↔ UI mapping. */
export const STEPS = {
	UPDATE_PACKAGES: "Updating system packages",
	THERMAL_SENSORS: "Configuring thermal sensors",
	DISABLE_IRQBALANCE: "Disabling irqbalance",
	CREATE_USERS: "Creating system users",
	WRITE_CONFIG: "Writing configuration",
	SYSTEMD_SERVICES: "Installing systemd services",
	HELPER_SCRIPTS: "Installing helper scripts",
	DASHBOARD: "Installing dashboard",
	RUNNER_INFRA: "Installing runner infrastructure",
	BOOT_PARAMS: "Configuring boot parameters",
	BOOTSTRAP_INVITE: "Creating bootstrap invite",
	START_SERVICES: "Starting services",
	TAILSCALE: "Setting up Tailscale",
} as const;

/** Returns the ordered step names for the given config. */
export function getInstallSteps(config: SetupConfig, isFirstRun: boolean): string[] {
	const steps: string[] = [
		STEPS.UPDATE_PACKAGES,
		STEPS.THERMAL_SENSORS,
		STEPS.DISABLE_IRQBALANCE,
		STEPS.CREATE_USERS,
		STEPS.WRITE_CONFIG,
		STEPS.SYSTEMD_SERVICES,
		STEPS.HELPER_SCRIPTS,
		STEPS.DASHBOARD,
		STEPS.RUNNER_INFRA,
		STEPS.BOOT_PARAMS,
	];
	if (isFirstRun) steps.push(STEPS.BOOTSTRAP_INVITE);
	steps.push(STEPS.START_SERVICES);
	if (config.tailscaleAuthKey) steps.push(STEPS.TAILSCALE);
	return steps;
}

export interface InstallStep {
	name: string;
	status: "pending" | "running" | "done" | "error";
	error?: string;
}

type ProgressCallback = (step: string, status: InstallStep["status"], error?: string) => void;
type OutputCallback = (line: string) => void;

function run(cmd: string): void {
	execSync(cmd, { stdio: "pipe" });
}

/** Run a command asynchronously so Ink can keep rendering (spinner animation). */
export function runAsync(cmd: string, onOutput?: (line: string) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("bash", ["-c", cmd], { stdio: "pipe" });
		const tail: string[] = [];
		const handleData = (data: Buffer) => {
			const lines = data.toString().split("\n").filter(Boolean);
			for (const line of lines) {
				const trimmed = line.trim();
				tail.push(trimmed);
				if (tail.length > 20) tail.shift();
				onOutput?.(trimmed);
			}
		};
		proc.stdout?.on("data", handleData);
		proc.stderr?.on("data", handleData);
		proc.on("close", (code: number) => {
			if (code === 0) resolve();
			else {
				const detail = tail.length > 0 ? `\n${tail.join("\n")}` : "";
				reject(new Error(`Command failed (exit ${code}): ${cmd}${detail}`));
			}
		});
		proc.on("error", reject);
	});
}

/** Yield to the event loop so Ink can re-render between install steps. */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 50));
}

type InstallResult = { needsReboot: boolean; inviteUrl: string | null; fatal?: string };

function fatal(step: string, err: unknown, onProgress: ProgressCallback): InstallResult {
	onProgress(step, "error", String(err));
	return { needsReboot: false, inviteUrl: null, fatal: String(err) };
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
	options: { isFirstRun: boolean; onOutput?: OutputCallback } = { isFirstRun: true },
): Promise<InstallResult> {
	const onOutput = options.onOutput;
	let needsReboot = false;

	// 1. System packages — pre-installed in the image, but apt-get install
	// is a no-op for already-installed packages, and the update pulls
	// security patches on first boot.
	onProgress(STEPS.UPDATE_PACKAGES, "running");
	await tick();
	try {
		await runAsync("apt-get update -q", onOutput);
		await runAsync(
			"apt-get install -y -q podman sqlite3 lm-sensors cpufrequtils util-linux sudo htop curl ca-certificates openssh-server linux-perf socat",
			onOutput,
		);
		onProgress(STEPS.UPDATE_PACKAGES, "done");
	} catch (err) {
		onProgress(STEPS.UPDATE_PACKAGES, "error", String(err));
	}

	// 1b. Configure thermal sensors
	onProgress(STEPS.THERMAL_SENSORS, "running");
	await tick();
	try {
		// sensors-detect auto-mode writes modprobe configs for detected sensors
		run("yes | sensors-detect --auto 2>/dev/null || true");
		onProgress(STEPS.THERMAL_SENSORS, "done");
	} catch (err) {
		onProgress(STEPS.THERMAL_SENSORS, "error", String(err));
	}

	// 1c. Disable irqbalance (conflicts with our IRQ pinning)
	onProgress(STEPS.DISABLE_IRQBALANCE, "running");
	await tick();
	try {
		run("systemctl stop irqbalance 2>/dev/null || true");
		run("systemctl disable irqbalance 2>/dev/null || true");
		run("systemctl mask irqbalance 2>/dev/null || true");
		onProgress(STEPS.DISABLE_IRQBALANCE, "done");
	} catch (err) {
		onProgress(STEPS.DISABLE_IRQBALANCE, "error", String(err));
	}

	// 2. Create system users
	onProgress(STEPS.CREATE_USERS, "running");
	await tick();
	try {
		// bench user: may already exist from image build (customize-image.sh).
		// On ISO installs, create as a regular login user. On SBC images, already exists.
		try {
			run("id bench");
		} catch {
			run("adduser --disabled-password --gecos 'Noron Benchmark' bench");
			run("usermod -aG sudo bench");
		}
		// runner user: system user inside the container, but also needed on host
		// for runner-ctl and podman operations
		try {
			run("id runner");
		} catch {
			run("useradd -r -s /bin/bash -G bench runner");
		}
		ensureDir("/var/lib/bench");
		run("chown bench:bench /var/lib/bench");
		onProgress(STEPS.CREATE_USERS, "done");
	} catch (err) {
		return fatal(STEPS.CREATE_USERS, err, onProgress);
	}

	// 3. Write config files
	onProgress(STEPS.WRITE_CONFIG, "running");
	await tick();
	try {
		ensureDir("/etc/benchd");
		run("chown root:bench /etc/benchd");
		chmodSync("/etc/benchd", 0o770);
		writeFileSync("/etc/benchd/config.toml", generateBenchdConfig(config));
		run("chown root:bench /etc/benchd/config.toml");
		chmodSync("/etc/benchd/config.toml", 0o640);

		// Generate encryption key for token storage (AES-256-GCM)
		// Skip if already present (reconfigure path)
		const encKeyPath = "/etc/benchd/encryption.key";
		if (!existsSync(encKeyPath)) {
			const keyHex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");
			writeFileSync(encKeyPath, `${keyHex}\n`, { mode: 0o640 });
			run(`chown root:bench ${encKeyPath}`);
		}
		writeFileSync("/etc/sysctl.d/99-benchmark.conf", generateSysctlConfig());
		run("sysctl --system -q");
		onProgress(STEPS.WRITE_CONFIG, "done");
	} catch (err) {
		return fatal(STEPS.WRITE_CONFIG, err, onProgress);
	}

	// 4. Write systemd units
	onProgress(STEPS.SYSTEMD_SERVICES, "running");
	await tick();
	try {
		writeFileSync("/etc/systemd/system/benchd.service", generateBenchdService());
		writeFileSync("/etc/systemd/system/benchmark.slice", generateBenchmarkSlice(config));
		writeFileSync("/etc/systemd/system/bench-web.service", generateBenchWebService(config));
		writeFileSync("/etc/systemd/system/runner-ctld.service", generateRunnerCtldService());
		writeFileSync("/etc/systemd/system/bench-irq-pin.service", generateIrqPinService(config));
		writeFileSync("/etc/systemd/system/bench-tuning.service", generateDisableTurboService());
		writeFileSync("/etc/systemd/system/bench-cpu-governor.service", generateCpuGovernorService());
		writeFileSync("/etc/systemd/system/bench-runner-update.service", generateRunnerUpdateService());
		writeFileSync("/etc/systemd/system/bench-runner-update.timer", generateRunnerUpdateTimer());

		// Tmpfs mount unit for benchmark I/O isolation (LLVM guideline)
		// Size based on available RAM — skip entirely on low-memory devices
		const tmpfsSize = recommendTmpfsSize(config.totalMemoryMB);
		if (tmpfsSize) {
			const tmpfsPath = "/mnt/bench-tmpfs";
			// systemd mount units: path separators become "-", but hyphens
			// within path components must be escaped as "\x2d"
			const unitName = tmpfsPath
				.slice(1)
				.split("/")
				.map((seg) => seg.replace(/-/g, "\\x2d"))
				.join("-"); // mnt-bench\x2dtmpfs
			writeFileSync(
				`/etc/systemd/system/${unitName}.mount`,
				generateTmpfsMount(tmpfsPath, tmpfsSize),
			);
			ensureDir(tmpfsPath);
		}

		run("systemctl daemon-reload");
		onProgress(STEPS.SYSTEMD_SERVICES, "done");
	} catch (err) {
		return fatal(STEPS.SYSTEMD_SERVICES, err, onProgress);
	}

	// 5. Write helper scripts
	onProgress(STEPS.HELPER_SCRIPTS, "running");
	await tick();
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

		// Runner update script — search all known locations
		const updateSources = [
			"/usr/local/share/bench/bench-runner-update.sh",
			"/usr/local/share/bench/runner/bench-runner-update.sh",
			`${import.meta.dir}/../../../runner-image/bench-runner-update.sh`,
		];
		let foundUpdateScript = false;
		for (const src of updateSources) {
			if (existsSync(src)) {
				run(`cp ${src} /usr/local/bin/bench-runner-update`);
				chmodSync("/usr/local/bin/bench-runner-update", 0o755);
				foundUpdateScript = true;
				break;
			}
		}
		if (!foundUpdateScript) {
			throw new Error(
				`bench-runner-update.sh not found. Searched:\n${updateSources.map((s) => `  ${s}`).join("\n")}`,
			);
		}

		// Sudoers
		writeFileSync("/etc/sudoers.d/bench-exec", generateSudoersConfig());
		chmodSync("/etc/sudoers.d/bench-exec", 0o440);

		onProgress(STEPS.HELPER_SCRIPTS, "done");
	} catch (err) {
		onProgress(STEPS.HELPER_SCRIPTS, "error", String(err));
	}

	// 6. Copy dashboard assets
	onProgress(STEPS.DASHBOARD, "running");
	await tick();
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
		onProgress(STEPS.DASHBOARD, "done");
	} catch (err) {
		onProgress(STEPS.DASHBOARD, "error", String(err));
	}

	// 7. Install runner infrastructure (hooks, runner-ctl, Podman image)
	onProgress(STEPS.RUNNER_INFRA, "running");
	await tick();
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

		// Build runner container image (may take a few minutes on first setup).
		// bench-runner-update --force skips the lock check since benchd isn't running yet.
		// This is also the script the weekly timer uses for subsequent rebuilds.
		// Retry once on failure — network issues during image pull are transient.
		try {
			await runAsync("bench-runner-update --force", onOutput);
		} catch (firstErr) {
			onOutput?.("Runner image build failed, retrying...");
			await runAsync("bench-runner-update --force", onOutput);
		}

		onProgress(STEPS.RUNNER_INFRA, "done");
	} catch (err) {
		return fatal(STEPS.RUNNER_INFRA, err, onProgress);
	}

	// 8. Configure boot loader for CPU isolation
	onProgress(STEPS.BOOT_PARAMS, "running");
	await tick();
	try {
		if (config.isolatedCores.length > 0) {
			const append = generateGrubAppend(config);
			const grubDefault = "/etc/default/grub";
			const armbianEnv = "/boot/armbianEnv.txt";

			if (existsSync(armbianEnv) && isArm()) {
				// Armbian SBCs: kernel params via extraargs in armbianEnv.txt
				const env = readFileSync(armbianEnv, "utf-8");
				writeFileSync(armbianEnv, updateArmbianEnv(env, append));
				needsReboot = true;
			} else if (existsSync(grubDefault) && !isArm()) {
				// x86: update GRUB
				const grub = readFileSync(grubDefault, "utf-8");
				writeFileSync(grubDefault, updateGrubDefault(grub, append));
				run("update-grub");
				needsReboot = true;
			} else if (isArm()) {
				// RPi / other ARM: update cmdline.txt
				const cmdlinePaths = ["/boot/firmware/cmdline.txt", "/boot/cmdline.txt"];
				for (const cmdlinePath of cmdlinePaths) {
					if (existsSync(cmdlinePath)) {
						const cmdline = readFileSync(cmdlinePath, "utf-8");
						writeFileSync(cmdlinePath, `${updateCmdline(cmdline, append)}\n`);
						needsReboot = true;
						break;
					}
				}
			}
		}
		onProgress(STEPS.BOOT_PARAMS, "done");
	} catch (err) {
		onProgress(STEPS.BOOT_PARAMS, "error", String(err));
	}

	// 8. Create bootstrap invite (first run only — reconfigure preserves existing DB/users)
	let inviteUrl: string | null = null;
	if (options.isFirstRun) {
		onProgress(STEPS.BOOTSTRAP_INVITE, "running");
		await tick();
		try {
			const dbPath = "/var/lib/bench/bench.db";
			const token = crypto.randomUUID();
			const now = Date.now();
			const expiresAt = now + 7 * 24 * 3600_000; // 7 days
			run(
				`sqlite3 "${dbPath}" "CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT)"`,
			);
			run(
				`sqlite3 "${dbPath}" "INSERT INTO invites (id, token, created_at, expires_at) VALUES ('${crypto.randomUUID()}', '${token}', ${now}, ${expiresAt})"`,
			);
			run(`chown bench:bench "${dbPath}"`);
			chmodSync(dbPath, 0o640);
			const hasProtocol = /^https?:\/\//.test(config.hostname);
			const baseUrl = hasProtocol
				? config.hostname.startsWith("http://")
					? `${config.hostname.replace(/\/+$/, "")}:${config.webPort}`
					: config.hostname.replace(/\/+$/, "")
				: `https://${config.hostname}`;
			inviteUrl = `${baseUrl}/invite/${token}`;
			onProgress(STEPS.BOOTSTRAP_INVITE, "done");
		} catch (err) {
			onProgress(STEPS.BOOTSTRAP_INVITE, "error", String(err));
		}
	}

	// 9. Enable and start services
	onProgress(STEPS.START_SERVICES, "running");
	await tick();
	try {
		// Core services — must succeed
		run("systemctl enable --now benchd");
		run("systemctl enable --now runner-ctld");
		run("systemctl enable --now bench-web");

		// Tuning services — enable them but don't fail the whole setup if
		// they can't start (e.g. in containers/VMs during testing).
		// They'll start on next boot when running on real hardware.
		const tuningServices = [
			...(recommendTmpfsSize(config.totalMemoryMB) ? ["mnt-bench\\x2dtmpfs.mount"] : []),
			"bench-irq-pin",
			"bench-tuning",
			"bench-cpu-governor",
			"bench-runner-update.timer",
		];
		for (const svc of tuningServices) {
			try {
				run(`systemctl enable ${svc}`);
				run(`systemctl start ${svc}`);
			} catch {
				// Enable succeeded (will start on reboot) but start failed
				// (missing kernel interfaces in this environment)
			}
		}

		onProgress(STEPS.START_SERVICES, "done");
	} catch (err) {
		return fatal(STEPS.START_SERVICES, err, onProgress);
	}

	// 10. Optional: Tailscale
	if (config.tailscaleAuthKey) {
		onProgress(STEPS.TAILSCALE, "running");
		await tick();
		try {
			if (!existsSync("/usr/bin/tailscale")) {
				await runAsync("curl -fsSL https://tailscale.com/install.sh | sh", onOutput);
			}
			run(`tailscale up --authkey=${config.tailscaleAuthKey} --hostname=bench-${config.hostname}`);
			run(`tailscale funnel --bg ${config.webPort}`);
			onProgress(STEPS.TAILSCALE, "done");
		} catch (err) {
			onProgress(STEPS.TAILSCALE, "error", String(err));
		}
	}

	// 11. Mark setup complete — must happen before reboot prompt so it
	// persists even if the user reboots or the process is killed.
	try {
		ensureDir("/var/lib/bench");
		run("touch /var/lib/bench/.setup-complete");
	} catch {
		/* best effort */
	}

	// 12. Tighten permissions — remove bench from sudo group now that setup is complete.
	// The scoped sudoers rules in /etc/sudoers.d/ provide the specific access bench needs.
	try {
		run("gpasswd -d bench sudo");
	} catch {
		/* may not be in sudo group (reconfigure path) */
	}

	return { needsReboot, inviteUrl };
}
