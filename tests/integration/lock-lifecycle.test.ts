import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BenchdClient, DEFAULT_CONFIG } from "../../packages/shared/src/index";
import type { LockAcquiredResponse, LockQueuedResponse, ConfigGetResponse } from "../../packages/shared/src/protocol";
import type { CpuTopology } from "../../packages/shared/src/cpu-topology";
import { BenchdServer } from "../../packages/benchd/src/server";

const testTopology: CpuTopology = {
	totalCores: 4,
	onlineCores: [0, 1, 2, 3],
	recommendedIsolated: [1, 2, 3],
	recommendedHousekeeping: 0,
	thermalZones: [],
};

describe("Lock lifecycle integration", () => {
	const socketPath = join(tmpdir(), `benchd-test-${process.pid}.sock`);
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

	test("single client acquires and releases lock", async () => {
		const client = new BenchdClient(socketPath);
		await client.connect();

		const acquired = await client.request({
			type: "lock.acquire",
			requestId: crypto.randomUUID(),
			jobId: "job-1",
			runId: "run-1",
			owner: "org/repo",
		});

		expect(acquired.type).toBe("lock.acquired");
		expect((acquired as LockAcquiredResponse).position).toBe(0);
		const jobToken = (acquired as LockAcquiredResponse).jobToken;
		expect(jobToken).toBeTruthy();

		// Mark action invoked to avoid violation
		await client.request({
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken,
		});

		const released = await client.request({
			type: "lock.release",
			requestId: crypto.randomUUID(),
			jobToken,
			jobId: "job-1",
		});

		expect(released.type).toBe("lock.released");
		client.close();
	});

	test("second client queues when lock is held", async () => {
		const clientA = new BenchdClient(socketPath);
		const clientB = new BenchdClient(socketPath);
		await clientA.connect();
		await clientB.connect();

		// Client A acquires
		const acqA = await clientA.request({
			type: "lock.acquire",
			requestId: crypto.randomUUID(),
			jobId: "job-a",
			runId: "run-a",
			owner: "org/repo-a",
		});
		expect(acqA.type).toBe("lock.acquired");
		const tokenA = (acqA as LockAcquiredResponse).jobToken;

		// Client B tries to acquire — should get queued
		const acqBPromise = clientB.request({
			type: "lock.acquire",
			requestId: crypto.randomUUID(),
			jobId: "job-b",
			runId: "run-b",
			owner: "org/repo-b",
		});

		// Give it a moment to process the queue message
		await new Promise((r) => setTimeout(r, 50));

		// Mark action invoked on A before releasing
		await clientA.request({
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken: tokenA,
		});

		// Client A releases — Client B should get the lock
		await clientA.request({
			type: "lock.release",
			requestId: crypto.randomUUID(),
			jobToken: tokenA,
			jobId: "job-a",
		});

		const acqB = await acqBPromise;
		expect(acqB.type).toBe("lock.acquired");
		const tokenB = (acqB as LockAcquiredResponse).jobToken;

		// Mark action invoked on B and release
		await clientB.request({
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken: tokenB,
		});

		// Client B releases
		await clientB.request({
			type: "lock.release",
			requestId: crypto.randomUUID(),
			jobToken: tokenB,
			jobId: "job-b",
		});

		clientA.close();
		clientB.close();
	});

	test("lock status reports current state", async () => {
		const client = new BenchdClient(socketPath);
		await client.connect();

		// Check idle state
		const idleStatus = await client.request({
			type: "lock.status",
			requestId: crypto.randomUUID(),
		});
		expect(idleStatus.type).toBe("lock.status");
		if (idleStatus.type === "lock.status") {
			expect(idleStatus.held).toBe(false);
			expect(idleStatus.queueDepth).toBe(0);
		}

		// Acquire and check held state
		const acq = await client.request({
			type: "lock.acquire",
			requestId: crypto.randomUUID(),
			jobId: "job-status",
			runId: "run-status",
			owner: "org/repo",
		});
		const jobToken = (acq as LockAcquiredResponse).jobToken;

		const heldStatus = await client.request({
			type: "lock.status",
			requestId: crypto.randomUUID(),
		});
		if (heldStatus.type === "lock.status") {
			expect(heldStatus.held).toBe(true);
			expect(heldStatus.holder?.jobId).toBe("job-status");
		}

		await client.request({
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken,
		});

		await client.request({
			type: "lock.release",
			requestId: crypto.randomUUID(),
			jobToken,
			jobId: "job-status",
		});

		client.close();
	});

	test("privileged operations without token are rejected", async () => {
		const client = new BenchdClient(socketPath);
		await client.connect();

		// Try thermal.wait without a valid token — client rejects errors as thrown exceptions
		try {
			await client.request({
				type: "thermal.wait",
				requestId: crypto.randomUUID(),
				jobToken: "fake-token",
				targetTemp: 45,
			});
			// Should not reach here
			expect(true).toBe(false);
		} catch (err) {
			expect((err as Error).message).toContain("Invalid or missing job token");
		}

		client.close();
	});

	test("config.get returns system configuration", async () => {
		const client = new BenchdClient(socketPath);
		await client.connect();

		const config = await client.request({
			type: "config.get",
			requestId: crypto.randomUUID(),
		});

		expect(config.type).toBe("config.get");
		if (config.type === "config.get") {
			const resp = config as ConfigGetResponse;
			expect(resp.isolatedCores).toEqual([1, 2, 3]);
			expect(resp.housekeepingCore).toBe(0);
			expect(resp.totalCores).toBe(4);
			expect(Array.isArray(resp.thermalZones)).toBe(true);
			expect(resp.configPath).toBe("/tmp/benchd-test-config.toml");
		}

		client.close();
	});
});
