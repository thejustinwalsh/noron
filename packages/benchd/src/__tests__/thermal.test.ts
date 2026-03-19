import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ClientConnection } from "../connection";
import { ThermalMonitor } from "../thermal";

function mockClient(): { messages: object[]; send: (msg: object) => void } {
	const messages: object[] = [];
	return {
		messages,
		send(msg: object) {
			messages.push(msg);
		},
	};
}

describe("ThermalMonitor", () => {
	let monitor: ThermalMonitor;

	beforeEach(() => {
		monitor = new ThermalMonitor(50, () => {});
	});

	afterEach(() => {
		monitor.stop();
	});

	test("currentTemp is null before start", () => {
		expect(monitor.currentTemp).toBeNull();
	});

	test("currentTrend defaults to stable", () => {
		expect(monitor.currentTrend).toBe("stable");
	});

	test("getStatus returns zeroed state before any readings", () => {
		const c = mockClient();
		monitor.getStatus(c as unknown as ClientConnection, {
			type: "thermal.status",
			requestId: "r1",
		});

		const resp = c.messages[0] as { type: string; currentTemp: number; trend: string };
		expect(resp.type).toBe("thermal.status");
		expect(resp.currentTemp).toBe(0);
		expect(resp.trend).toBe("stable");
	});

	test("waitForTarget with null temp queues waiter", () => {
		const c = mockClient();
		monitor.waitForTarget(c as unknown as ClientConnection, {
			type: "thermal.wait",
			requestId: "r1",
			jobToken: "test-token",
			targetTemp: 45,
		});

		expect(c.messages).toHaveLength(0);
	});

	test("waiter timeout fires even without thermal sensor", async () => {
		monitor.start();

		const c = mockClient();
		monitor.waitForTarget(c as unknown as ClientConnection, {
			type: "thermal.wait",
			requestId: "r1",
			jobToken: "test-token",
			targetTemp: 10,
			timeout: 80,
		});

		await new Promise((r) => setTimeout(r, 200));

		// On macOS (no sensor): should still timeout via deadline check
		// On Linux: may get thermal.ready if temp < 10, or thermal.timeout
		expect(c.messages.length).toBeGreaterThanOrEqual(1);
		const resp = c.messages[0] as { type: string };
		expect(["thermal.ready", "thermal.timeout"]).toContain(resp.type);
	});

	test("stop is idempotent", () => {
		monitor.start();
		monitor.stop();
		monitor.stop();
	});

	test("getIdleBaseline returns null initially (no readings yet)", () => {
		expect(monitor.getIdleBaseline()).toBeNull();
	});

	test("getEffectiveTarget(0) returns 45 fallback when no baseline established", () => {
		expect(monitor.getIdleBaseline()).toBeNull();
		expect(monitor.getEffectiveTarget(0)).toBe(45);
	});

	test("getEffectiveTarget with explicit value passes it through unchanged", () => {
		expect(monitor.getEffectiveTarget(50)).toBe(50);
		expect(monitor.getEffectiveTarget(60)).toBe(60);
		expect(monitor.getEffectiveTarget(30)).toBe(30);
	});
});
