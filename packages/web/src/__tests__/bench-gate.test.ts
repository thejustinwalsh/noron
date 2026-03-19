import { describe, test, expect } from "bun:test";
import { BenchGate } from "../bench-gate";

describe("BenchGate", () => {
	test("starts in OPEN state", () => {
		const gate = new BenchGate();
		expect(gate.state).toBe("open");
		expect(gate.activeOps).toBe(0);
	});

	test("enterGate resolves immediately when OPEN", async () => {
		const gate = new BenchGate();
		const pass = await gate.enterGate();
		expect(gate.activeOps).toBe(1);
		pass.exit();
		expect(gate.activeOps).toBe(0);
	});

	test("enterGate tracks activeOps correctly", async () => {
		const gate = new BenchGate();
		const pass1 = await gate.enterGate();
		const pass2 = await gate.enterGate();
		const pass3 = await gate.enterGate();
		expect(gate.activeOps).toBe(3);
		pass1.exit();
		expect(gate.activeOps).toBe(2);
		pass2.exit();
		expect(gate.activeOps).toBe(1);
		pass3.exit();
		expect(gate.activeOps).toBe(0);
	});

	test("closeGate transitions OPEN → DRAINING → LOCKED", async () => {
		const gate = new BenchGate(50, 100);
		const transitions: string[] = [];
		gate.on("stateChange", (from, to) => transitions.push(`${from}→${to}`));

		// Enter gate first so there's something to drain
		const pass = await gate.enterGate();

		const closePromise = gate.closeGate();
		expect(gate.state).toBe("draining");

		// Complete the in-flight op
		pass.exit();
		await closePromise;
		expect(gate.state).toBe("locked");
		expect(transitions).toEqual(["open→draining", "draining→locked"]);
	});

	test("closeGate with no active ops skips DRAINING", async () => {
		const gate = new BenchGate();
		const transitions: string[] = [];
		gate.on("stateChange", (from, to) => transitions.push(`${from}→${to}`));

		await gate.closeGate();
		expect(gate.state).toBe("locked");
		// Should go through both transitions synchronously
		expect(transitions).toEqual(["open→draining", "draining→locked"]);
	});

	test("closeGate waits for in-flight ops to drain", async () => {
		const gate = new BenchGate(50, 100);

		const pass1 = await gate.enterGate();
		const pass2 = await gate.enterGate();

		let drained = false;
		const closePromise = gate.closeGate().then(() => {
			drained = true;
		});

		expect(gate.state).toBe("draining");
		expect(drained).toBe(false);

		pass1.exit();
		// Need a microtask tick
		await Promise.resolve();
		expect(drained).toBe(false); // Still one op in-flight

		pass2.exit();
		await closePromise;
		expect(drained).toBe(true);
		expect(gate.state).toBe("locked");
	});

	test("enterGate blocks when LOCKED", async () => {
		const gate = new BenchGate();
		await gate.closeGate();
		expect(gate.state).toBe("locked");

		let entered = false;
		const enterPromise = gate.enterGate().then((pass) => {
			entered = true;
			return pass;
		});

		await new Promise((r) => setTimeout(r, 20));
		expect(entered).toBe(false);

		gate.openGate();
		const pass = await enterPromise;
		expect(entered).toBe(true);
		expect(gate.activeOps).toBe(1);
		pass.exit();
	});

	test("enterGate resumes on openGate", async () => {
		const gate = new BenchGate();
		await gate.closeGate();

		let entered = false;
		const enterPromise = gate.enterGate().then((pass) => {
			entered = true;
			return pass;
		});

		// Still blocked
		await Promise.resolve();
		expect(entered).toBe(false);

		gate.openGate();
		const pass = await enterPromise;
		expect(entered).toBe(true);
		pass.exit();
	});

	test("multiple enterGate waiters all resume on openGate", async () => {
		const gate = new BenchGate();
		await gate.closeGate();

		const results: number[] = [];
		const promises = [1, 2, 3].map((n) =>
			gate.enterGate().then((pass) => {
				results.push(n);
				return pass;
			}),
		);

		await new Promise((r) => setTimeout(r, 20));
		expect(results).toEqual([]);

		gate.openGate();
		const passes = await Promise.all(promises);
		expect(results.sort()).toEqual([1, 2, 3]);
		expect(gate.activeOps).toBe(3);

		for (const pass of passes) pass.exit();
		expect(gate.activeOps).toBe(0);
	});

	test("hard deadline fires AbortSignal and force-completes", async () => {
		const gate = new BenchGate(25, 50);

		const pass = await gate.enterGate();
		let aborted = false;
		pass.signal.addEventListener("abort", () => {
			aborted = true;
		});

		const closePromise = gate.closeGate();
		expect(gate.state).toBe("draining");

		// Wait for hard deadline
		await closePromise;
		expect(aborted).toBe(true);
		expect(gate.state).toBe("locked");
		expect(gate.activeOps).toBe(0);

		// exit() after force-close is safe
		pass.exit();
		expect(gate.activeOps).toBe(0);
	});

	test("soft deadline emits warning but does not abort", async () => {
		const gate = new BenchGate(25, 200);

		const pass = await gate.enterGate();

		const timeouts: Array<{ level: string; ops: number }> = [];
		gate.on("drainTimeout", (level, activeOps) => {
			timeouts.push({ level, ops: activeOps });
		});

		gate.closeGate();

		// Wait for soft deadline to fire
		await new Promise((r) => setTimeout(r, 40));
		expect(timeouts).toEqual([{ level: "soft", ops: 1 }]);
		expect(pass.signal.aborted).toBe(false);
		expect(gate.state).toBe("draining"); // Still draining, not force-closed

		// Clean up: complete the drain
		pass.exit();
	});

	test("openGate is idempotent when already OPEN", () => {
		const gate = new BenchGate();
		const transitions: string[] = [];
		gate.on("stateChange", (from, to) => transitions.push(`${from}→${to}`));

		gate.openGate();
		gate.openGate();
		expect(transitions).toEqual([]);
		expect(gate.state).toBe("open");
	});

	test("closeGate is idempotent when already LOCKED", async () => {
		const gate = new BenchGate();
		await gate.closeGate();

		const transitions: string[] = [];
		gate.on("stateChange", (from, to) => transitions.push(`${from}→${to}`));

		await gate.closeGate();
		expect(transitions).toEqual([]);
		expect(gate.state).toBe("locked");
	});

	test("closeGate during DRAINING joins existing drain", async () => {
		const gate = new BenchGate(50, 200);

		const pass = await gate.enterGate();
		const close1 = gate.closeGate("holder-1");
		const close2 = gate.closeGate("holder-2"); // should join

		expect(gate.state).toBe("draining");

		pass.exit();
		await Promise.all([close1, close2]);
		expect(gate.state).toBe("locked");
	});

	test("exit() after force-close is safe no-op", async () => {
		const gate = new BenchGate(10, 30);

		const pass = await gate.enterGate();
		await gate.closeGate(); // will hit hard deadline

		expect(gate.state).toBe("locked");
		expect(gate.activeOps).toBe(0);

		// Calling exit() again should not throw or go negative
		pass.exit();
		expect(gate.activeOps).toBe(0);
	});

	test("snapshot returns correct state", async () => {
		const gate = new BenchGate();

		let snap = gate.snapshot();
		expect(snap.state).toBe("open");
		expect(snap.activeOps).toBe(0);
		expect(snap.holder).toBeUndefined();

		const pass = await gate.enterGate();
		snap = gate.snapshot();
		expect(snap.activeOps).toBe(1);

		pass.exit();
		await gate.closeGate("test-bench");
		snap = gate.snapshot();
		expect(snap.state).toBe("locked");
		expect(snap.holder).toBe("test-bench");
	});
});
