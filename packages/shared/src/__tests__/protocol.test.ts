import { describe, expect, test } from "bun:test";
import type {
	LockAcquireRequest,
	LockAcquiredResponse,
	Request,
	Response,
	StatusUpdate,
	ThermalWaitRequest,
} from "../protocol";

describe("Protocol types", () => {
	test("lock.acquire request serializes correctly", () => {
		const msg: LockAcquireRequest = {
			type: "lock.acquire",
			requestId: "test-123",
			jobId: "build",
			runId: "456",
			owner: "org/repo",
		};
		const json = JSON.stringify(msg);
		const parsed = JSON.parse(json) as LockAcquireRequest;
		expect(parsed.type).toBe("lock.acquire");
		expect(parsed.requestId).toBe("test-123");
		expect(parsed.jobId).toBe("build");
		expect(parsed.owner).toBe("org/repo");
	});

	test("lock.acquired response round-trips", () => {
		const msg: LockAcquiredResponse = {
			type: "lock.acquired",
			requestId: "test-123",
			position: 0,
			jobToken: "abc123",
		};
		const parsed = JSON.parse(JSON.stringify(msg)) as LockAcquiredResponse;
		expect(parsed.type).toBe("lock.acquired");
		expect(parsed.position).toBe(0);
	});

	test("thermal.wait request round-trips", () => {
		const msg: ThermalWaitRequest = {
			type: "thermal.wait",
			requestId: "test-456",
			jobToken: "token-456",
			targetTemp: 45,
			timeout: 120000,
		};
		const parsed = JSON.parse(JSON.stringify(msg)) as ThermalWaitRequest;
		expect(parsed.type).toBe("thermal.wait");
		expect(parsed.targetTemp).toBe(45);
		expect(parsed.timeout).toBe(120000);
	});

	test("status.update round-trips", () => {
		const msg: StatusUpdate = {
			type: "status.update",
			requestId: "sub-1",
			timestamp: Date.now(),
			lock: {
				jobId: "test",
				runId: "789",
				owner: "org/repo",
				acquiredAt: Date.now() - 5000,
				duration: 5000,
			},
			queueDepth: 2,
			thermal: { currentTemp: 42.3, trend: "falling" },
			cpu: 12.5,
			memory: { usedMb: 1024, totalMb: 4096, percent: 25.0 },
			uptime: 3600000,
			version: "0.1.0",
		};
		const parsed = JSON.parse(JSON.stringify(msg)) as StatusUpdate;
		expect(parsed.type).toBe("status.update");
		expect(parsed.lock?.jobId).toBe("test");
		expect(parsed.thermal.trend).toBe("falling");
		expect(parsed.queueDepth).toBe(2);
	});

	test("line-delimited JSON framing", () => {
		const messages: Request[] = [
			{
				type: "lock.acquire",
				requestId: "1",
				jobId: "a",
				runId: "1",
				owner: "x/y",
			},
			{
				type: "thermal.wait",
				requestId: "2",
				jobToken: "tok",
				targetTemp: 45,
			},
		];

		const wire = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
		const parsed = wire
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Request);

		expect(parsed).toHaveLength(2);
		expect(parsed[0].type).toBe("lock.acquire");
		expect(parsed[1].type).toBe("thermal.wait");
	});
});
