#!/usr/bin/env bun
/**
 * bench-exec: Privileged benchmark executor
 *
 * Deployed with a sudoers rule:
 *   runner ALL=(root) NOPASSWD: /usr/local/bin/bench-exec
 *
 * Validates the benchmark session with benchd, applies CPU affinity,
 * nice priority, and I/O scheduling, then drops privileges and exec's
 * the user's command.
 */
import { parseArgs } from "node:util";
import { BenchdClient, SOCKET_PATH } from "@noron/shared";
import { applyCpuAffinity, applyIonice, applyNice, dropPrivileges } from "./syscalls";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		cores: { type: "string" },
		nice: { type: "string", default: "-20" },
		ionice: { type: "string", default: "1" },
	},
	allowPositionals: true,
	strict: true,
});

if (positionals.length === 0) {
	console.error(
		"Usage: bench-exec [--cores 1,2,3] [--nice -20] [--ionice 1] -- <command> [args...]",
	);
	process.exit(1);
}

const sessionId = process.env.BENCH_SESSION_ID;
if (!sessionId) {
	console.error("bench-exec: BENCH_SESSION_ID environment variable is required");
	process.exit(1);
}

const jobToken = process.env.BENCH_JOB_TOKEN;
if (!jobToken) {
	console.error("bench-exec: BENCH_JOB_TOKEN environment variable is required");
	process.exit(1);
}

const socketPath = process.env.BENCHD_SOCKET ?? SOCKET_PATH;

// Step 1: Validate session with benchd
const client = new BenchdClient(socketPath);
try {
	await client.connect();
} catch (err) {
	console.error(`bench-exec: Failed to connect to benchd at ${socketPath}: ${err}`);
	process.exit(1);
}

const validation = await client.request({
	type: "exec.validate",
	requestId: crypto.randomUUID(),
	jobToken,
	sessionId,
	pid: process.pid,
});
client.close();

if (validation.type === "exec.invalid") {
	console.error(`bench-exec: Session validation failed: ${validation.reason}`);
	process.exit(1);
}

if (validation.type === "error") {
	console.error(`bench-exec: Error from benchd: ${(validation as { message: string }).message}`);
	process.exit(1);
}

// Step 2: Determine cores — use CLI arg or query benchd for config
let cores: number[];
if (values.cores) {
	cores = values.cores.split(",").map(Number);
} else {
	try {
		const configClient = new BenchdClient(socketPath);
		await configClient.connect();
		const configResp = await configClient.request({
			type: "config.get",
			requestId: crypto.randomUUID(),
		});
		configClient.close();
		if (configResp.type === "config.get") {
			cores = configResp.isolatedCores;
		} else {
			console.error("bench-exec: Could not get config from benchd, using fallback cores [1,2,3]");
			cores = [1, 2, 3];
		}
	} catch {
		console.error("bench-exec: Could not query benchd for cores, using fallback [1,2,3]");
		cores = [1, 2, 3];
	}
}

// Step 3: Apply performance settings
const nicePriority = Number.parseInt(values.nice as string, 10);
const ioniceClass = Number.parseInt(values.ionice as string, 10);

try {
	applyCpuAffinity(cores);
	applyNice(nicePriority);
	applyIonice(ioniceClass);
} catch (err) {
	console.error(`bench-exec: Failed to apply performance settings: ${err}`);
	process.exit(1);
}

// Step 4: Drop privileges back to the invoking user
try {
	dropPrivileges();
} catch (err) {
	console.error(`bench-exec: Failed to drop privileges: ${err}`);
	process.exit(1);
}

// Step 5: Exec the command (inherits stdio)
const [command, ...args] = positionals;
const proc = Bun.spawn([command, ...args], {
	stdio: ["inherit", "inherit", "inherit"],
	env: { ...process.env, BENCH_SESSION_ID: undefined, BENCH_JOB_TOKEN: undefined },
});

const exitCode = await proc.exited;
process.exit(exitCode);
