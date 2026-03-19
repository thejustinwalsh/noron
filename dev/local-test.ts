#!/usr/bin/env bun
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Local development test script.
 *
 * Starts benchd + bench-web, opens the dashboard, then runs a simulated
 * benchmark job so you can watch the UI update in real time.
 *
 * Usage:
 *   bun dev/local-test.ts              # start services + run one benchmark
 *   bun dev/local-test.ts --serve      # start services and keep running (Ctrl+C to stop)
 *   bun dev/local-test.ts --bench-only # run a benchmark against already-running services
 */
import { parseArgs } from "node:util";
import { BenchdServer } from "../packages/benchd/src/server";
import { DEFAULT_CONFIG } from "../packages/shared/src/config";
import { detectCpuTopology } from "../packages/shared/src/cpu-topology";
import { BenchdClient } from "../packages/shared/src/ipc-client";

const { values: flags } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		serve: { type: "boolean", default: false },
		"bench-only": { type: "boolean", default: false },
		port: { type: "string", default: "9216" },
		socket: { type: "string", default: join(tmpdir(), "benchd-dev.sock") },
	},
	strict: true,
});

const SOCKET = flags.socket!;
const PORT = Number.parseInt(flags.port!, 10);
const DB_PATH = join(tmpdir(), "bench-dev.db");
const WF_DB_PATH = join(tmpdir(), "bench-dev-wf.db");
const DASHBOARD_DIR = "packages/dashboard/dist";

// ── Bench-only mode: just run a benchmark against existing services ──────────

if (flags["bench-only"]) {
	await runBenchmark();
	process.exit(0);
}

// ── Full mode: start services ────────────────────────────────────────────────

console.log("\n  Noron — Local Dev\n");

// Check dashboard is built
if (!existsSync(join(DASHBOARD_DIR, "index.html"))) {
	console.error("  Dashboard not built. Run: cd packages/dashboard && bun run build");
	process.exit(1);
}

// Clean stale socket
if (existsSync(SOCKET)) unlinkSync(SOCKET);

// Start benchd in-process
const topology = detectCpuTopology();
const config = { ...DEFAULT_CONFIG, socketPath: SOCKET, thermalPollIntervalMs: 500 };
const server = new BenchdServer({
	socketPath: SOCKET,
	logLevel: "info",
	config,
	topology,
	configPath: "/dev/null",
});
await server.start();
console.log(`  benchd listening on ${SOCKET}`);

// Start bench-web as subprocess
const webProc = Bun.spawn(["bun", "run", "packages/web/src/main.ts"], {
	env: {
		...process.env,
		BENCHD_SOCKET: SOCKET,
		DATABASE_PATH: DB_PATH,
		WORKFLOW_DB_PATH: WF_DB_PATH,
		PORT: String(PORT),
		DASHBOARD_DIR,
	},
	stdout: "inherit",
	stderr: "inherit",
});
console.log(`  bench-web starting on :${PORT}...`);

// Wait for web readiness
const deadline = Date.now() + 10_000;
while (Date.now() < deadline) {
	try {
		const res = await fetch(`http://localhost:${PORT}/`, { redirect: "manual" });
		if (res.status === 302 || res.status === 200) break;
	} catch {}
	await new Promise((r) => setTimeout(r, 200));
}
console.log(`  Dashboard: http://localhost:${PORT}/dashboard/\n`);

// Cleanup handler
async function cleanup() {
	console.log("\n  Shutting down...");
	try {
		webProc.kill("SIGTERM");
	} catch {}
	await server.shutdown();
	for (const p of [
		DB_PATH,
		`${DB_PATH}-wal`,
		`${DB_PATH}-shm`,
		WF_DB_PATH,
		`${WF_DB_PATH}-wal`,
		`${WF_DB_PATH}-shm`,
	]) {
		try {
			if (existsSync(p)) unlinkSync(p);
		} catch {}
	}
	console.log("  Clean.\n");
}

process.on("SIGINT", async () => {
	await cleanup();
	process.exit(0);
});
process.on("SIGTERM", async () => {
	await cleanup();
	process.exit(0);
});

if (flags.serve) {
	console.log("  Running in serve mode — Ctrl+C to stop.");
	console.log("  To run a benchmark in another terminal:\n");
	console.log(`    bun dev/local-test.ts --bench-only --socket ${SOCKET}\n`);
	// Keep alive
	await new Promise(() => {});
} else {
	// Run one benchmark, then shut down
	await runBenchmark();
	await cleanup();
}

// ── Benchmark runner ─────────────────────────────────────────────────────────

async function runBenchmark() {
	const client = new BenchdClient(SOCKET);
	await client.connect();

	// Step 1: Acquire lock
	console.log("  [1/5] Acquiring lock...");
	const acq = await client.request({
		type: "lock.acquire",
		requestId: crypto.randomUUID(),
		jobId: "dev-bench",
		runId: `run-${Date.now()}`,
		owner: "local/dev-test",
	});
	if (acq.type !== "lock.acquired") {
		console.error(`  Unexpected: ${JSON.stringify(acq)}`);
		client.close();
		return;
	}
	const jobToken = (acq as { jobToken: string }).jobToken;
	console.log("  [1/5] Lock acquired ✓");

	// Step 1.5: Action checkin (simulates the noron action registering)
	await client.request({
		type: "action.checkin",
		requestId: crypto.randomUUID(),
		jobToken,
	});

	// Step 2: Thermal wait
	console.log("  [2/5] Thermal wait (2s timeout)...");
	const thermal = await client.request({
		type: "thermal.wait",
		requestId: crypto.randomUUID(),
		jobToken,
		targetTemp: 45,
		timeout: 2000,
	});
	if (thermal.type === "thermal.ready") {
		console.log(`  [2/5] Thermal ready at ${(thermal as { currentTemp: number }).currentTemp}°C ✓`);
	} else {
		console.log("  [2/5] Thermal timed out (no sensor) — proceeding ✓");
	}

	// Step 3: Run benchmark
	console.log("  [3/5] Running benchmark...");
	const proc = Bun.spawn(["bun", "run", "tests/e2e/fixtures/bench-sample.ts"], {
		stdout: "pipe",
		stderr: "inherit",
	});
	const output = await new Response(proc.stdout).text();
	await proc.exited;
	const result = JSON.parse(output.trim());
	console.log(
		`  [3/5] ${result.benchmark}: mean=${result.mean_ns}ns min=${result.min_ns}ns max=${result.max_ns}ns ✓`,
	);

	// Step 4: Hold lock briefly so dashboard shows the state
	console.log("  [4/5] Holding lock for 3s (watch the dashboard)...");
	await new Promise((r) => setTimeout(r, 3000));

	// Step 5: Release lock
	console.log("  [5/5] Releasing lock...");
	await client.request({
		type: "lock.release",
		requestId: crypto.randomUUID(),
		jobToken,
		jobId: "dev-bench",
	});
	console.log("  [5/5] Lock released ✓\n");

	client.close();
}
