import { spawn } from "node:child_process";
/**
 * Composite GitHub Action entry point.
 * Bundled to dist/index.js targeting Node (not Bun) since the
 * GitHub Actions runner provides Node.
 *
 * Orchestrates: action.checkin → thermal wait → cgroup prepare → bench-exec spawn
 */
import { readFileSync } from "node:fs";
import { type Socket, connect } from "node:net";

const SOCKET_PATH = process.env.BENCHD_SOCKET ?? "/var/run/benchd.sock";
const JOB_TOKEN_PATH = process.env.JOB_TOKEN_PATH ?? "/opt/actions-runner/.benchd-token";

// --- Minimal IPC client for Node (no Bun APIs) ---

function sendRequest(socketPath: string, msg: object): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const socket: Socket = connect({ path: socketPath });
		let buffer = "";

		socket.on("connect", () => {
			socket.write(`${JSON.stringify(msg)}\n`);
		});

		socket.on("data", (data: Buffer) => {
			buffer += data.toString();
			const idx = buffer.indexOf("\n");
			if (idx !== -1) {
				const line = buffer.slice(0, idx);
				socket.end();
				try {
					resolve(JSON.parse(line));
				} catch {
					reject(new Error(`Invalid JSON from benchd: ${line}`));
				}
			}
		});

		socket.on("error", (err: Error) => reject(err));
		socket.on("close", () => {
			if (!buffer.includes("\n")) {
				reject(new Error("Connection closed before response"));
			}
		});
	});
}

async function run(): Promise<void> {
	const command = process.env.BENCH_COMMAND;
	if (!command) {
		console.log("::error::BENCH_COMMAND is required");
		process.exitCode = 1;
		return;
	}

	// Read job token written by job-started hook
	let jobToken = "";
	try {
		jobToken = readFileSync(JOB_TOKEN_PATH, "utf-8").trim();
	} catch {
		console.log(
			"::error::Could not read job token. Ensure the noron job-started hook is configured.",
		);
		process.exitCode = 1;
		return;
	}

	if (!jobToken) {
		console.log("::error::Job token is empty. Ensure the noron job-started hook is configured.");
		process.exitCode = 1;
		return;
	}

	const targetTemp = Number.parseInt(process.env.BENCH_TARGET_TEMP ?? "0", 10);
	const timeoutSec = Number.parseInt(process.env.BENCH_TIMEOUT ?? "300", 10);

	// Step 0: Check in with benchd (proves the noron action is in use)
	try {
		const checkin = await sendRequest(SOCKET_PATH, {
			type: "action.checkin",
			requestId: crypto.randomUUID(),
			jobToken,
		});

		if (checkin.type === "error") {
			console.log(`::error::Action checkin failed: ${checkin.message}`);
			process.exitCode = 1;
			return;
		}
		console.log("Noron action registered with benchd");
	} catch (err) {
		console.log(`::error::Could not reach benchd for action checkin: ${err}`);
		process.exitCode = 1;
		return;
	}

	// Determine cores and tmpfs: use input, or query benchd for auto-detected config
	let cores = process.env.BENCH_CORES ?? "";
	let benchTmpfs = "";
	if (!cores) {
		try {
			const configResp = await sendRequest(SOCKET_PATH, {
				type: "config.get",
				requestId: crypto.randomUUID(),
			});
			if (configResp.type === "config.get" && Array.isArray(configResp.isolatedCores)) {
				cores = (configResp.isolatedCores as number[]).join(",");
				benchTmpfs = (configResp.benchTmpfs as string) ?? "";
				console.log(`Auto-detected isolated cores from benchd: ${cores}`);
				if (benchTmpfs) console.log(`Benchmark tmpfs: ${benchTmpfs}`);
			} else {
				console.log("::warning::Could not get core config from benchd, using fallback 1,2,3");
				cores = "1,2,3";
			}
		} catch {
			console.log("::warning::Could not reach benchd for core config, using fallback 1,2,3");
			cores = "1,2,3";
		}
	}

	// Step 1: Wait for thermal stabilization
	console.log(
		`::group::Thermal stabilization (target: ${targetTemp === 0 ? "auto" : `${targetTemp}°C`})`,
	);
	try {
		const thermal = await sendRequest(SOCKET_PATH, {
			type: "thermal.wait",
			requestId: crypto.randomUUID(),
			jobToken,
			targetTemp,
			timeout: timeoutSec * 1000,
		});

		if (thermal.type === "thermal.timeout") {
			console.log(
				`::warning::Thermal stabilization timed out at ${thermal.currentTemp}°C (target: ${targetTemp}°C)`,
			);
		} else if (thermal.type === "thermal.ready") {
			console.log(`CPU temperature stable at ${thermal.currentTemp}°C`);
		} else if (thermal.type === "error") {
			console.log(`::warning::Thermal check error: ${thermal.message}`);
		}
	} catch (err) {
		console.log(`::warning::Could not reach benchd for thermal check: ${err}`);
	}
	console.log("::endgroup::");

	// Step 2: Prepare benchmark cgroup
	console.log("::group::Benchmark isolation setup");
	let sessionId = "";
	try {
		const exec = await sendRequest(SOCKET_PATH, {
			type: "exec.prepare",
			requestId: crypto.randomUUID(),
			jobToken,
			cores: cores.split(",").map(Number),
			priority: -20,
		});

		if (exec.type === "exec.ready") {
			sessionId = exec.sessionId as string;
			console.log(`Cgroup: ${exec.cgroupPath}`);
			console.log(`Session: ${sessionId}`);
		} else {
			console.log(`::warning::Cgroup setup failed: ${JSON.stringify(exec)}`);
		}
	} catch (err) {
		console.log(`::warning::Could not reach benchd for exec setup: ${err}`);
	}
	console.log("::endgroup::");

	// Step 3: Run the benchmark via bench-exec
	// If tmpfs is available, set TMPDIR so all temp I/O goes to RAM automatically.
	const benchEnv: Record<string, string> = {
		...(process.env as Record<string, string>),
		BENCH_SESSION_ID: sessionId,
		BENCH_JOB_TOKEN: jobToken,
	};
	const useTmpfs = process.env.BENCH_USE_TMPFS !== "false";
	if (benchTmpfs && useTmpfs) {
		benchEnv.TMPDIR = benchTmpfs;
		benchEnv.BENCH_TMPFS = benchTmpfs;
		console.log(`Using tmpfs at ${benchTmpfs} for benchmark I/O (TMPDIR set automatically)`);
		console.log("All temp file operations will use RAM-backed storage for consistent I/O latency.");
	} else if (!useTmpfs) {
		console.log("Tmpfs disabled for this run (use-tmpfs: false). Benchmark I/O will use disk.");
	} else {
		console.log(
			"::notice::No tmpfs available — benchmark I/O will use disk. For lower variance, configure tmpfs in /etc/benchd/config.toml (requires sufficient RAM).",
		);
	}

	console.log(`::group::Benchmark: ${command}`);
	const exitCode = await new Promise<number>((resolve) => {
		const args = [
			"/usr/local/bin/bench-exec",
			"--cores",
			cores,
			"--nice",
			"-20",
			"--ionice",
			"1",
			"--",
			...command.split(" "),
		];

		const child = spawn("sudo", args, {
			stdio: "inherit",
			env: benchEnv,
		});

		child.on("close", (code) => resolve(code ?? 1));
		child.on("error", (err) => {
			console.error(`::error::Failed to spawn bench-exec: ${err.message}`);
			resolve(1);
		});
	});
	console.log("::endgroup::");

	if (exitCode !== 0) {
		console.log(`::error::Benchmark exited with code ${exitCode}`);
		process.exitCode = exitCode;
	}
}

run().catch((err) => {
	console.error(`::error::${err}`);
	process.exitCode = 1;
});
