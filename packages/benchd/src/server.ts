import { unlinkSync, existsSync, chmodSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { BENCHMARK_TMPFS, readThrottleCounts } from "@noron/shared";
import type { BenchdConfig, CpuTopology, Request, StatusUpdate, ViolationEvent } from "@noron/shared";
import { ClientConnection } from "./connection";
import { CgroupManager } from "./cgroup";
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
	private thermal: ThermalMonitor;
	private cgroup: CgroupManager;
	private sysMetrics = new SysMetrics();
	private startedAt = 0;
	private throttleBaseline: Map<number, number> | null = null;
	private lastThrottleResult: { cores: number[]; totalEvents: number } | null = null;

	constructor(private options: BenchdServerOptions) {
		const { config, topology } = options;
		this.lock = new LockManager(
			() => this.broadcastStatus(),
			config.jobTimeoutMs,
			(owner, jobId, runId) => this.handleJobTimeout(owner, jobId, runId),
			(repo, jobId, runId, reason) => this.broadcastViolation(repo, jobId, runId, reason),
		);
		this.thermal = new ThermalMonitor(config.thermalPollIntervalMs, () =>
			this.broadcastStatus(),
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
			this.server = createServer((socket: Socket) => {
				this.handleConnection(socket);
			});

			this.server.listen(this.options.socketPath, () => {
				// Allow non-root services (bench-web) to connect
				try { chmodSync(this.options.socketPath, 0o770); } catch {}
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
		const client = new ClientConnection(socket, (msg) =>
			this.handleMessage(client, msg),
		);

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
				break;
			case "lock.release": {
				// Diff throttle counts before releasing the lock
				this.diffThrottleCounts();
				this.lock.release(client, msg);
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
			cpu: this.sysMetrics.readCpu(),
			memory: this.sysMetrics.readMemory(),
			uptime: Date.now() - this.startedAt,
			version: process.env.NORON_VERSION ?? "dev",
			system: {
				isolatedCores: this.options.config.isolatedCores,
				housekeepingCore: this.options.config.housekeepingCore,
				totalCores: this.options.topology.totalCores,
			},
		};

		if (this.lastThrottleResult) {
			update.throttled = this.lastThrottleResult;
		}

		return update;
	}
}
