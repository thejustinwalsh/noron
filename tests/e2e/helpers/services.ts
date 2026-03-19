import { type Subprocess } from "bun";
import { unlinkSync, existsSync } from "node:fs";
import { BenchdServer } from "../../../packages/benchd/src/server";
import { testTopology, makeTestConfig } from "./fixtures";

export interface TestServicesOptions {
	socketPath: string;
	dbPath: string;
	workflowDbPath: string;
	port: number;
}

/**
 * Manages benchd (in-process) and bench-web (subprocess) for e2e tests.
 * Guarantees cleanup on shutdown and best-effort cleanup on process exit.
 */
export class TestServices {
	private exitHandler: (() => void) | null = null;

	private constructor(
		public server: BenchdServer,
		public webProc: Subprocess,
		public port: number,
		public socketPath: string,
		private opts: TestServicesOptions,
	) {}

	static async start(opts: TestServicesOptions): Promise<TestServices> {
		const config = makeTestConfig(opts.socketPath);

		const server = new BenchdServer({
			socketPath: opts.socketPath,
			logLevel: "warn",
			config,
			topology: testTopology,
			configPath: "/tmp/benchd-e2e-config.toml",
		});
		await server.start();

		// Spawn bench-web as a subprocess
		const webProc = Bun.spawn(["bun", "run", "packages/web/src/main.ts"], {
			env: {
				...process.env,
				BENCHD_SOCKET: opts.socketPath,
				DATABASE_PATH: opts.dbPath,
				WORKFLOW_DB_PATH: opts.workflowDbPath,
				PORT: String(opts.port),
				DASHBOARD_DIR: "packages/dashboard/dist",
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const services = new TestServices(server, webProc, opts.port, opts.socketPath, opts);

		// Best-effort sync cleanup on unexpected exit
		services.exitHandler = () => {
			try { webProc.kill("SIGKILL"); } catch {}
		};
		process.on("exit", services.exitHandler);

		// Wait for bench-web to be ready
		await services.waitForWeb(10_000);

		return services;
	}

	/** Poll bench-web until it responds. Uses root redirect (no auth needed). */
	private async waitForWeb(timeoutMs: number): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		let delay = 100;

		while (Date.now() < deadline) {
			try {
				const res = await fetch(`http://localhost:${this.port}/`, { redirect: "manual" });
				if (res.status === 302 || res.status === 200) return;
			} catch {
				// Connection refused — bench-web not ready yet
			}
			await new Promise((r) => setTimeout(r, delay));
			delay = Math.min(delay * 1.5, 1000);
		}
		throw new Error(`bench-web did not become ready within ${timeoutMs}ms`);
	}

	async shutdown(): Promise<void> {
		// Remove exit handler
		if (this.exitHandler) {
			process.removeListener("exit", this.exitHandler);
			this.exitHandler = null;
		}

		// Stop bench-web subprocess
		try {
			this.webProc.kill("SIGTERM");
			// Wait up to 3 seconds for graceful shutdown
			const timeout = setTimeout(() => {
				try { this.webProc.kill("SIGKILL"); } catch {}
			}, 3000);
			await this.webProc.exited;
			clearTimeout(timeout);
		} catch {
			// Already dead
		}

		// Stop benchd
		await this.server.shutdown();

		// Clean up temp files
		for (const path of [
			this.opts.dbPath,
			`${this.opts.dbPath}-wal`,
			`${this.opts.dbPath}-shm`,
			this.opts.workflowDbPath,
			`${this.opts.workflowDbPath}-wal`,
			`${this.opts.workflowDbPath}-shm`,
		]) {
			try { if (existsSync(path)) unlinkSync(path); } catch {}
		}
	}
}
