import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BenchdServer } from "../../packages/benchd/src/server";
import type { CpuTopology } from "../../packages/shared/src/cpu-topology";
import { BenchdClient, DEFAULT_CONFIG } from "../../packages/shared/src/index";
import type { LockAcquiredResponse } from "../../packages/shared/src/protocol";

/**
 * Security-focused integration tests for the IPC token system.
 * Verifies that token-gated operations are properly enforced and that
 * clients cannot escalate privileges or use expired/stolen tokens.
 */

const testTopology: CpuTopology = {
	totalCores: 4,
	onlineCores: [0, 1, 2, 3],
	recommendedIsolated: [1, 2, 3],
	recommendedHousekeeping: 0,
	thermalZones: [],
};

describe("Token security", () => {
	const socketPath = join(tmpdir(), `benchd-token-sec-${process.pid}.sock`);
	let server: BenchdServer;

	beforeAll(async () => {
		server = new BenchdServer({
			socketPath,
			logLevel: "error",
			config: { ...DEFAULT_CONFIG, socketPath },
			topology: testTopology,
			configPath: "/tmp/benchd-test-config.toml",
		});
		await server.start();
	});

	afterAll(async () => {
		await server.shutdown();
	});

	test("token from one job cannot release a different job's lock", async () => {
		const client = new BenchdClient(socketPath);
		await client.connect();

		// Acquire lock, get a valid token
		const acq = await client.request({
			type: "lock.acquire",
			requestId: crypto.randomUUID(),
			jobId: "job-real",
			runId: "run-1",
			owner: "org/repo",
		});
		const realToken = (acq as LockAcquiredResponse).jobToken;

		// Release with the real token (should work)
		await client.request({
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken: realToken,
		});
		const released = await client.request({
			type: "lock.release",
			requestId: crypto.randomUUID(),
			jobToken: realToken,
			jobId: "job-real",
		});
		expect(released.type).toBe("lock.released");

		// Acquire again
		const acq2 = await client.request({
			type: "lock.acquire",
			requestId: crypto.randomUUID(),
			jobId: "job-2",
			runId: "run-2",
			owner: "org/repo",
		});
		const token2 = (acq2 as LockAcquiredResponse).jobToken;

		// Try to release with the OLD token (should fail — token was invalidated)
		try {
			await client.request({
				type: "lock.release",
				requestId: crypto.randomUUID(),
				jobToken: realToken,
				jobId: "job-2",
			});
			expect(true).toBe(false); // should not reach
		} catch (err) {
			expect((err as Error).message).toContain("Invalid");
		}

		// Clean up with the correct token
		await client.request({
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken: token2,
		});
		await client.request({
			type: "lock.release",
			requestId: crypto.randomUUID(),
			jobToken: token2,
			jobId: "job-2",
		});
		client.close();
	});

	test("empty token is rejected for all privileged operations", async () => {
		const client = new BenchdClient(socketPath);
		await client.connect();

		const privilegedOps = [
			{
				type: "thermal.wait" as const,
				jobToken: "",
				targetTemp: 45,
			},
			{
				type: "exec.prepare" as const,
				jobToken: "",
			},
			{
				type: "action.checkin" as const,
				jobToken: "",
			},
		];

		for (const op of privilegedOps) {
			try {
				await client.request({
					...op,
					requestId: crypto.randomUUID(),
				});
				expect(true).toBe(false); // should not reach
			} catch (err) {
				expect((err as Error).message).toContain("Invalid");
			}
		}

		client.close();
	});

	test("non-privileged operations work without any token", async () => {
		const client = new BenchdClient(socketPath);
		await client.connect();

		// config.get should work without token
		const config = await client.request({
			type: "config.get",
			requestId: crypto.randomUUID(),
		});
		expect(config.type).toBe("config.get");

		// lock.status should work without token
		const status = await client.request({
			type: "lock.status",
			requestId: crypto.randomUUID(),
		});
		expect(status.type).toBe("lock.status");

		client.close();
	});

	// exec.validate with mismatched session ID is covered by
	// packages/benchd/src/__tests__/cgroup.test.ts — "validate with unknown session"
});
