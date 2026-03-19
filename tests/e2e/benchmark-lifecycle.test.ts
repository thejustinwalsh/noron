import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { BenchdClient } from "../../packages/shared/src/ipc-client";
import type { LockAcquiredResponse } from "../../packages/shared/src/protocol";
import { TestServices } from "./helpers/services";
import { uniquePaths } from "./helpers/fixtures";
import { findAvailablePort } from "./helpers/ports";

/** Seed a test user + session token into the bench-web DB. */
function seedTestUser(dbPath: string): string {
	const db = new Database(dbPath);
	const userId = crypto.randomUUID();
	const token = crypto.randomUUID();
	db.run(
		"INSERT OR IGNORE INTO users (id, github_id, github_login, role, created_at) VALUES (?, 99999, 'e2e-test', 'admin', ?)",
		[userId, Date.now()],
	);
	db.run(
		"INSERT INTO device_codes (code, user_code, created_at, expires_at, user_id, token) VALUES (?, 'E2ETEST', ?, ?, ?, ?)",
		[crypto.randomUUID(), Date.now(), Date.now() + 3600_000, userId, token],
	);
	db.close();
	return token;
}

describe("Benchmark lifecycle e2e", () => {
	let services: TestServices;
	let client: BenchdClient;
	let authToken: string;
	const jobId = "e2e-bench-job";
	const runId = "e2e-run-123";
	const owner = "test-org/test-repo";

	beforeAll(async () => {
		const paths = uniquePaths("lifecycle");
		const port = await findAvailablePort();
		services = await TestServices.start({ ...paths, port });

		// Seed a test user after bench-web has initialized the DB
		authToken = seedTestUser(paths.dbPath);

		client = new BenchdClient(paths.socketPath);
		await client.connect();
	}, 30_000);

	afterAll(async () => {
		client?.close();
		await services?.shutdown();
	});

	function authFetch(path: string) {
		return fetch(`http://localhost:${services.port}${path}`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
	}

	test("full job lifecycle", async () => {
		// Step 1 — Lock acquire (simulates job-started hook)
		const acquired = await client.request({
			type: "lock.acquire",
			requestId: crypto.randomUUID(),
			jobId,
			runId,
			owner,
		});
		expect(acquired.type).toBe("lock.acquired");
		const jobToken = (acquired as LockAcquiredResponse).jobToken;
		expect(jobToken).toBeTruthy();
		if (acquired.type === "lock.acquired") {
			expect(acquired.position).toBe(0);
		}

		// Step 1.5 — Action checkin (simulates noron action registering)
		const checkin = await client.request({
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken,
		});
		expect(checkin.type).toBe("action.checkin");

		// Step 2 — Verify lock held via HTTP API (requires auth)
		const statusRes = await authFetch("/api/status");
		expect(statusRes.ok).toBe(true);
		const status = (await statusRes.json()) as {
			lock: { held: boolean; holder: { jobId: string } };
		};
		expect(status.lock.held).toBe(true);
		expect(status.lock.holder.jobId).toBe(jobId);

		// Step 3 — Thermal wait (short timeout, accepts ready or timeout)
		const thermal = await client.request({
			type: "thermal.wait",
			requestId: crypto.randomUUID(),
			jobToken,
			targetTemp: 45,
			timeout: 2000,
		});
		if (thermal.type === "thermal.ready") {
			console.log(`  [e2e] Thermal: ready at ${(thermal as { currentTemp: number }).currentTemp}°C`);
		} else if (thermal.type === "thermal.timeout") {
			console.log(`  [e2e] Thermal: timed out (no sensor or temp too high) — proceeding`);
		}
		expect(["thermal.ready", "thermal.timeout"]).toContain(thermal.type);

		// Step 4 — Run benchmark command
		const benchProc = Bun.spawn(["bun", "run", "tests/e2e/fixtures/bench-sample.ts"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const benchOutput = await new Response(benchProc.stdout).text();
		const benchExit = await benchProc.exited;
		expect(benchExit).toBe(0);

		const benchResult = JSON.parse(benchOutput.trim()) as {
			benchmark: string;
			iterations: number;
			mean_ns: number;
			min_ns: number;
			max_ns: number;
		};
		expect(benchResult.benchmark).toBe("fib-1000");
		expect(benchResult.iterations).toBe(100);
		expect(benchResult.mean_ns).toBeGreaterThan(0);
		console.log(`  [e2e] Benchmark: ${benchResult.benchmark} mean=${benchResult.mean_ns}ns`);

		// Step 5 — Lock release (simulates job-completed hook)
		const released = await client.request({
			type: "lock.release",
			requestId: crypto.randomUUID(),
			jobToken,
			jobId,
		});
		expect(released.type).toBe("lock.released");

		// Step 6 — Verify system idle via HTTP API
		await new Promise((r) => setTimeout(r, 300));

		const idleRes = await authFetch("/api/status");
		expect(idleRes.ok).toBe(true);
		const idleStatus = (await idleRes.json()) as {
			lock: { held: boolean; queueDepth: number };
		};
		expect(idleStatus.lock.held).toBe(false);
	}, 30_000);

	test("unauthenticated /api/status returns 401", async () => {
		const res = await fetch(`http://localhost:${services.port}/api/status`);
		expect(res.status).toBe(401);
	});
});
