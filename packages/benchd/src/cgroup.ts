import { existsSync } from "node:fs";
import { mkdir, writeFile, rmdir } from "node:fs/promises";
import type {
	ExecPrepareRequest,
	ExecValidateRequest,
} from "@noron/shared";
import type { ClientConnection } from "./connection";
import { log } from "./logger";

interface ActiveSession {
	sessionId: string;
	cgroupPath: string;
	cores: number[];
	priority: number;
}

/**
 * Manages cgroup v2 resources for benchmark isolation.
 * Creates per-job cgroups under benchmark.slice with CPU pinning.
 */
export class CgroupManager {
	private sessions = new Map<string, ActiveSession>();

	constructor(
		private defaultCores: number[],
		private benchmarkCgroup: string,
	) {}

	async prepare(client: ClientConnection, msg: ExecPrepareRequest): Promise<void> {
		const sessionId = crypto.randomUUID();
		const cgroupPath = `${this.benchmarkCgroup}/job-${sessionId}`;
		const cores = msg.cores.length > 0 ? msg.cores : [...this.defaultCores];

		// On non-Linux (dev), skip actual cgroup creation
		if (existsSync("/sys/fs/cgroup")) {
			try {
				await mkdir(cgroupPath, { recursive: true });
				await writeFile(`${cgroupPath}/cpuset.cpus`, cores.join(","));
				await writeFile(`${cgroupPath}/cpuset.mems`, "0");
			} catch (err) {
				client.send({
					type: "error",
					requestId: msg.requestId,
					code: "cgroup.setup_failed",
					message: `Failed to setup cgroup: ${err}`,
				});
				return;
			}
		}

		const session: ActiveSession = {
			sessionId,
			cgroupPath,
			cores,
			priority: msg.priority,
		};
		this.sessions.set(sessionId, session);

		client.send({
			type: "exec.ready",
			requestId: msg.requestId,
			cgroupPath,
			sessionId,
		});

		log("info", "cgroup", `Prepared session ${sessionId}`, {
			cores: session.cores,
			cgroupPath,
		});
	}

	async validate(
		client: ClientConnection,
		msg: ExecValidateRequest,
	): Promise<void> {
		const session = this.sessions.get(msg.sessionId);
		if (!session) {
			client.send({
				type: "exec.invalid",
				requestId: msg.requestId,
				reason: `No active session: ${msg.sessionId}`,
			});
			return;
		}

		// Move the process into the benchmark cgroup
		if (existsSync(session.cgroupPath)) {
			try {
				await writeFile(`${session.cgroupPath}/cgroup.procs`, String(msg.pid));
			} catch (err) {
				log("warn", "cgroup", `Failed to move PID ${msg.pid} to cgroup: ${err}`);
				// Non-fatal — the bench-exec will handle CPU affinity via taskset
			}
		}

		client.send({
			type: "exec.validated",
			requestId: msg.requestId,
			cgroupPath: session.cgroupPath,
		});

		log("info", "cgroup", `Validated PID ${msg.pid} for session ${msg.sessionId}`);
	}

	/** Kill all processes in all active benchmark cgroups (used on timeout) */
	async killAll(): Promise<void> {
		for (const [sessionId, session] of this.sessions) {
			if (existsSync(session.cgroupPath)) {
				try {
					// cgroup v2: writing 1 to cgroup.kill terminates all processes
					await writeFile(`${session.cgroupPath}/cgroup.kill`, "1");
					log("warn", "cgroup", `Killed all processes in session ${sessionId}`);
				} catch (err) {
					log("warn", "cgroup", `Failed to kill processes in session ${sessionId}: ${err}`);
				}
			}
		}
	}

	async cleanup(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		this.sessions.delete(sessionId);

		if (existsSync(session.cgroupPath)) {
			try {
				await rmdir(session.cgroupPath);
			} catch {
				// cgroup may not be empty yet, that's ok
			}
		}

		log("info", "cgroup", `Cleaned up session ${sessionId}`);
	}
}
