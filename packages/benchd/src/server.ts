import { execSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { join } from "node:path";
import {
	BENCHMARK_TMPFS,
	THERMAL_HISTORY_SIZE,
	ThermalSensor,
	findCpuThermalZone,
	readThrottleCounts,
} from "@noron/shared";
import type {
	BenchdConfig,
	CpuTopology,
	Request,
	StatusUpdate,
	ViolationEvent,
} from "@noron/shared";
import { CgroupManager } from "./cgroup";
import { ClientConnection } from "./connection";
import { LockManager } from "./lock";
import { log } from "./logger";
import { SysMetrics } from "./sysmetrics";
import { ThermalMonitor } from "./thermal";

export interface BenchdServerOptions {
	socketPath: string;
	logLevel: string;
	config: BenchdConfig;
	topology: CpuTopology;
	configPath: string;
}

/** Message types that require a valid jobToken */
const TOKEN_REQUIRED_TYPES = new Set([
	"thermal.wait",
	"exec.prepare",
	"exec.validate",
	"action.checkin",
	"lock.release",
]);

export class BenchdServer {
	private server: Server | null = null;
	private clients = new Set<ClientConnection>();
	private subscribers = new Set<ClientConnection>();
	private lock: LockManager;
	private thermalStore: ThermalSensor;
	private thermal: ThermalMonitor;
	private cgroup: CgroupManager;
	private sysMetrics = new SysMetrics();
	private startedAt = 0;
	private lastMemory: StatusUpdate["memory"] = { usedMb: 0, totalMb: 0, percent: 0 };
	private lastDisk: StatusUpdate["disk"] = { usedGb: 0, totalGb: 0, percent: 0 };
	private lastDiskReadAt = 0;
	private throttleBaseline: Map<number, number> | null = null;
	private lastThrottleResult: { cores: number[]; totalEvents: number } | null = null;
	private lockAcquiredAt = 0;

	constructor(private options: BenchdServerOptions) {
		const { config, topology } = options;

		// Unified thermal sensor + ring buffer + backfill store.
		// Sized to hold full history + worst-case benchmark duration.
		const maxReadings = Math.max(
			THERMAL_HISTORY_SIZE,
			Math.ceil(config.jobTimeoutMs / config.thermalPollIntervalMs) + 1,
		);
		this.thermalStore = new ThermalSensor(maxReadings);

		const thermalPath = findCpuThermalZone();
		if (thermalPath) {
			try {
				this.thermalStore.openSensor(thermalPath);
			} catch (err) {
				console.warn(`[benchd] FFI thermal sensor failed, sensor disabled: ${err}`);
			}
		}

		this.lock = new LockManager(
			() => this.broadcastStatus(),
			config.jobTimeoutMs,
			(owner, jobId, runId) => this.handleJobTimeout(owner, jobId, runId),
			(repo, jobId, runId, reason) => this.broadcastViolation(repo, jobId, runId, reason),
		);
		this.thermal = new ThermalMonitor(
			config.thermalPollIntervalMs,
			this.thermalStore,
			() => {
				if (this.lock.currentHolder) {
					this.thermalStore.recordBackfill();
				} else {
					this.broadcastStatus();
				}
			},
			{
				thermalMarginC: config.thermalMarginC,
				baselineSettlingMs: config.thermalBaselineSettlingS * 1000,
			},
		);
		this.cgroup = new CgroupManager(config.isolatedCores, config.benchmarkCgroup);
	}

	async start(): Promise<void> {
		this.startedAt = Date.now();

		// Remove stale socket file
		if (existsSync(this.options.socketPath)) {
			unlinkSync(this.options.socketPath);
		}

		this.thermal.start();

		return new Promise((resolve) => {
			// Set restrictive umask before creating socket — prevents TOCTOU race
			// where connections arrive before permissions are applied
			const prevUmask = process.umask(0o007);

			this.server = createServer((socket: Socket) => {
				this.handleConnection(socket);
			});

			this.server.listen(this.options.socketPath, () => {
				process.umask(prevUmask);

				// Secure the socket: root:bench, mode 0770
				try {
					execSync(`chown root:bench ${this.options.socketPath}`);
					chmodSync(this.options.socketPath, 0o770);
				} catch {
					if (process.getuid?.() === 0) {
						// Running as root but chown failed — likely missing CAP_CHOWN
						// in the systemd unit. Fall back to 0o777; job tokens still
						// gate all privileged ops.
						log("warn", "server", "chown failed (missing CAP_CHOWN?) — using 0o777");
					}
					chmodSync(this.options.socketPath, 0o777);
				}
				log("info", "server", `Listening on ${this.options.socketPath}`);
				resolve();
			});
		});
	}

	async shutdown(): Promise<void> {
		log("info", "server", "Shutting down...");
		this.thermal.stop();

		for (const client of this.clients) {
			client.close();
		}

		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => {
					if (existsSync(this.options.socketPath)) {
						unlinkSync(this.options.socketPath);
					}
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	private handleConnection(socket: Socket): void {
		const client = new ClientConnection(socket, (msg) => this.handleMessage(client, msg));

		this.clients.add(client);
		log("info", "server", `Client connected (${this.clients.size} total)`);

		socket.on("close", () => {
			this.clients.delete(client);
			this.subscribers.delete(client);
			this.lock.handleDisconnect(client);
			log("info", "server", `Client disconnected (${this.clients.size} total)`);
		});
	}

	private handleMessage(client: ClientConnection, msg: Request): void {
		// Token validation gate for privileged operations
		if (TOKEN_REQUIRED_TYPES.has(msg.type)) {
			const token = (msg as { jobToken?: string }).jobToken;
			if (!token || !this.lock.validateToken(token)) {
				client.send({
					type: "error",
					requestId: msg.requestId,
					code: "auth.invalid_token",
					message: "Invalid or missing job token",
				});
				return;
			}
		}

		switch (msg.type) {
			case "lock.acquire":
				this.lock.acquire(client, msg);
				// Snapshot throttle counts when lock is granted
				this.throttleBaseline = readThrottleCounts();
				this.lastThrottleResult = null;
				this.thermalStore.beginBackfill();
				this.lockAcquiredAt = Date.now();
				break;
			case "lock.release": {
				// Diff throttle counts before releasing the lock
				this.diffThrottleCounts();
				this.lock.release(client, msg);
				this.flushLockThermalBuffer();
				this.cleanupTmpfs();
				break;
			}
			case "lock.status":
				this.lock.getStatus(client, msg);
				break;
			case "thermal.wait":
				this.thermal.waitForTarget(client, msg);
				break;
			case "thermal.status":
				this.thermal.getStatus(client, msg);
				break;
			case "exec.prepare":
				this.cgroup.prepare(client, msg);
				break;
			case "exec.validate":
				this.cgroup.validate(client, msg);
				break;
			case "action.checkin":
				this.handleActionCheckin(client, msg);
				break;
			case "config.get":
				client.send({
					type: "config.get",
					requestId: msg.requestId,
					isolatedCores: this.options.config.isolatedCores,
					housekeepingCore: this.options.config.housekeepingCore,
					totalCores: this.options.topology.totalCores,
					thermalZones: this.options.topology.thermalZones.map((z) => z.type),
					configPath: this.options.configPath,
					benchTmpfs: this.options.config.benchTmpfs,
				});
				break;
			case "lock.setTimeout": {
				const timeoutMs = (msg as { timeoutMs: number }).timeoutMs;
				if (typeof timeoutMs !== "number" || timeoutMs <= 0) {
					client.send({
						type: "error",
						requestId: msg.requestId,
						code: "invalid_timeout",
						message: "timeoutMs must be a positive number",
					});
				} else {
					this.lock.setCurrentTimeout(timeoutMs);
					client.send({
						type: "lock.setTimeout",
						requestId: msg.requestId,
						applied: true,
					});
					log("info", "server", `Job timeout updated to ${timeoutMs}ms`);
				}
				break;
			}
			case "status.subscribe":
				this.subscribers.add(client);
				// Send an immediate status update
				client.send(this.buildStatusUpdate(msg.requestId));
				break;
			default:
				client.send({
					type: "error",
					requestId: (msg as { requestId?: string }).requestId ?? "",
					code: "unknown_message",
					message: `Unknown message type: ${(msg as { type: string }).type}`,
				});
		}
	}

	private handleActionCheckin(client: ClientConnection, msg: Request & { jobToken: string }): void {
		const success = this.lock.markActionInvoked(msg.jobToken);
		client.send({
			type: "action.checkin",
			requestId: msg.requestId,
			acknowledged: success,
		});
	}

	private handleJobTimeout(owner: string, jobId: string, runId: string): void {
		log("warn", "server", `Job timeout: killing cgroup processes for ${owner}/${jobId}`);
		this.cgroup.killAll();
		this.cleanupTmpfs();
	}

	private broadcastViolation(
		repo: string,
		jobId: string,
		runId: string,
		reason: "action_not_used" | "job_timeout",
	): void {
		const event: ViolationEvent = {
			type: "violation.occurred",
			requestId: crypto.randomUUID(),
			repo,
			jobId,
			runId,
			reason,
		};
		for (const sub of this.subscribers) {
			sub.send(event);
		}
		log("info", "server", `Violation broadcast: ${reason} for ${repo}/${jobId}`);
	}

	/** Best-effort cleanup of tmpfs between benchmark runs to prevent data leakage */
	private cleanupTmpfs(): void {
		try {
			if (!existsSync(BENCHMARK_TMPFS)) return;
			const entries = readdirSync(BENCHMARK_TMPFS);
			for (const entry of entries) {
				try {
					rmSync(join(BENCHMARK_TMPFS, entry), { recursive: true, force: true });
				} catch {
					// best-effort — ignore individual file removal failures
				}
			}
			if (entries.length > 0) {
				log("info", "server", `Cleaned ${entries.length} entries from tmpfs`);
			}
		} catch {
			// best-effort — tmpfs may not exist on dev machines
		}
	}

	/** Throttle disk reads to once per 60s — disk changes slowly and statfs can trigger journal I/O */
	private readDiskThrottled(locked: boolean): StatusUpdate["disk"] {
		if (locked) return this.lastDisk;
		const now = Date.now();
		if (now - this.lastDiskReadAt >= 60_000) {
			this.lastDisk = this.sysMetrics.readDisk();
			this.lastDiskReadAt = now;
		}
		return this.lastDisk;
	}

	/** Send buffered thermal readings from the benchmark period to subscribers. */
	private flushLockThermalBuffer(): void {
		const backfill = this.thermalStore.flushBackfill();
		if (!backfill) return;
		for (const sub of this.subscribers) {
			sub.send({
				type: "thermal.backfill",
				requestId: sub.subscriptionRequestId ?? "",
				...backfill,
			});
		}
	}

	private broadcastStatus(): void {
		for (const sub of this.subscribers) {
			sub.send(this.buildStatusUpdate(sub.subscriptionRequestId ?? ""));
		}
	}

	private diffThrottleCounts(): void {
		if (this.throttleBaseline === null) return;
		const current = readThrottleCounts();
		if (current === null) return;

		const throttledCores: number[] = [];
		let totalEvents = 0;

		for (const [core, count] of current) {
			const baseline = this.throttleBaseline.get(core) ?? 0;
			const delta = count - baseline;
			if (delta > 0) {
				throttledCores.push(core);
				totalEvents += delta;
			}
		}

		if (throttledCores.length > 0) {
			this.lastThrottleResult = { cores: throttledCores, totalEvents };
			log(
				"warn",
				"thermal",
				`Thermal throttling detected on cores [${throttledCores.join(", ")}]: ${totalEvents} events`,
			);
		}

		this.throttleBaseline = null;
	}

	private buildStatusUpdate(requestId: string): StatusUpdate {
		// Skip expensive procfs/statfs reads while a benchmark holds the lock —
		// CPU%, memory%, disk% are dashboard-only metrics that cause memory bus
		// traffic and cache evictions on ARM SoCs with shared L3.
		const locked = this.lock.currentHolder !== null;
		const update: StatusUpdate = {
			type: "status.update",
			requestId,
			timestamp: Date.now(),
			lock: this.lock.currentHolder,
			queueDepth: this.lock.queueDepth,
			thermal: {
				currentTemp: this.thermal.currentTemp ?? 0,
				trend: this.thermal.currentTrend,
				idleBaseline: this.thermal.getIdleBaseline(),
			},
			cpu: locked ? 0 : this.sysMetrics.readCpu(),
			memory: locked ? this.lastMemory : this.sysMetrics.readMemory(),
			disk: this.readDiskThrottled(locked),
			uptime: Date.now() - this.startedAt,
			version: process.env.NORON_VERSION ?? "dev",
		};

		if (!locked) {
			this.lastMemory = update.memory;
		}

		if (this.lastThrottleResult) {
			update.throttled = this.lastThrottleResult;
		}

		return update;
	}
}
