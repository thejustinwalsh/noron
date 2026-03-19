import { describe, test, expect, afterEach } from "bun:test";
import { BenchGate } from "../bench-gate";
import { BenchScheduler } from "../bench-scheduler";

describe("BenchScheduler", () => {
	let gate: BenchGate;
	let scheduler: BenchScheduler;

	afterEach(() => {
		scheduler?.dispose();
	});

	test("executes registered tasks on interval", async () => {
		gate = new BenchGate();
		scheduler = new BenchScheduler(gate);

		let count = 0;
		scheduler.register({
			name: "test-task",
			fn: async () => {
				count++;
			},
			intervalMs: 30,
			initialDelayMs: 10,
		});

		await new Promise((r) => setTimeout(r, 100));
		expect(count).toBeGreaterThanOrEqual(2);
	});

	test("pauses tasks when gate closes", async () => {
		gate = new BenchGate();
		scheduler = new BenchScheduler(gate);

		let count = 0;
		scheduler.register({
			name: "test-task",
			fn: async () => {
				count++;
			},
			intervalMs: 20,
			initialDelayMs: 10,
		});

		// Let one execution happen
		await new Promise((r) => setTimeout(r, 40));
		const countBeforeClose = count;
		expect(countBeforeClose).toBeGreaterThanOrEqual(1);

		// Close gate — should pause
		await gate.closeGate();

		// Wait and verify no more executions
		await new Promise((r) => setTimeout(r, 60));
		expect(count).toBe(countBeforeClose);
	});

	test("resumes tasks when gate opens", async () => {
		gate = new BenchGate();
		scheduler = new BenchScheduler(gate);

		let count = 0;
		scheduler.register({
			name: "test-task",
			fn: async () => {
				count++;
			},
			intervalMs: 20,
			initialDelayMs: 10,
		});

		// Let one execution happen
		await new Promise((r) => setTimeout(r, 40));
		const countBeforeClose = count;

		// Close gate
		await gate.closeGate();
		await new Promise((r) => setTimeout(r, 40));
		expect(count).toBe(countBeforeClose);

		// Open gate — tasks should resume with short jitter (1-2s)
		gate.openGate();
		await new Promise((r) => setTimeout(r, 2500));
		expect(count).toBeGreaterThan(countBeforeClose);
	});

	test("skips tick if gate is not OPEN", async () => {
		gate = new BenchGate();
		await gate.closeGate();
		scheduler = new BenchScheduler(gate);

		let count = 0;
		scheduler.register({
			name: "test-task",
			fn: async () => {
				count++;
			},
			intervalMs: 10,
			initialDelayMs: 5,
		});

		// Gate is closed — task should not start
		await new Promise((r) => setTimeout(r, 50));
		expect(count).toBe(0);
	});

	test("skips tick if already running", async () => {
		gate = new BenchGate();
		scheduler = new BenchScheduler(gate);

		let concurrency = 0;
		let maxConcurrency = 0;

		scheduler.register({
			name: "slow-task",
			fn: async () => {
				concurrency++;
				maxConcurrency = Math.max(maxConcurrency, concurrency);
				await new Promise((r) => setTimeout(r, 50));
				concurrency--;
			},
			intervalMs: 10,
			initialDelayMs: 5,
		});

		await new Promise((r) => setTimeout(r, 120));
		expect(maxConcurrency).toBe(1);
	});

	test("unregister clears timer", async () => {
		gate = new BenchGate();
		scheduler = new BenchScheduler(gate);

		let count = 0;
		scheduler.register({
			name: "test-task",
			fn: async () => {
				count++;
			},
			intervalMs: 10,
			initialDelayMs: 5,
		});

		await new Promise((r) => setTimeout(r, 30));
		const countAtUnregister = count;
		scheduler.unregister("test-task");

		await new Promise((r) => setTimeout(r, 50));
		expect(count).toBe(countAtUnregister);
	});

	test("dispose clears all timers and subscriptions", async () => {
		gate = new BenchGate();
		scheduler = new BenchScheduler(gate);

		let count = 0;
		scheduler.register({
			name: "task-1",
			fn: async () => {
				count++;
			},
			intervalMs: 10,
			initialDelayMs: 5,
		});
		scheduler.register({
			name: "task-2",
			fn: async () => {
				count++;
			},
			intervalMs: 10,
			initialDelayMs: 5,
		});

		await new Promise((r) => setTimeout(r, 30));
		const countAtDispose = count;
		scheduler.dispose();

		await new Promise((r) => setTimeout(r, 50));
		expect(count).toBe(countAtDispose);
	});
});
