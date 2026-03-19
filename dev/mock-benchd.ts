#!/usr/bin/env bun
import { unlinkSync } from "node:fs";
/**
 * Mock benchd daemon for testing the CLI TUI.
 *
 * Listens on a Unix socket and speaks the benchd line-delimited JSON protocol
 * with simulated thermal, CPU, memory, and lock data.
 *
 * Usage:
 *   bun --filter @noron/dev mock-benchd
 *   # then in another terminal:
 *   bun packages/cli/src/index.ts monitor --socket /tmp/benchd-mock.sock
 *   bun packages/cli/src/index.ts status  --socket /tmp/benchd-mock.sock
 */
import { type Socket, createServer } from "node:net";

const SOCKET_PATH = process.env.MOCK_SOCKET ?? "/tmp/benchd-mock.sock";
const TICK_MS = 1000;

// --- Simulated state ---

let temp = 38 + Math.random() * 5;
let cpu = 10 + Math.random() * 15;
let memPercent = 45 + Math.random() * 10;
const memTotalMb = 8192;
const startTime = Date.now();
const thermalHistory: number[] = [];

// Occasionally simulate a lock being held
let lockHolder: {
	jobId: string;
	runId: string;
	owner: string;
	acquiredAt: number;
} | null = null;
let lockCooldown = 0;

function randomWalk(val: number, min: number, max: number, step: number): number {
	const delta = (Math.random() - 0.5) * step;
	return Math.max(min, Math.min(max, val + delta));
}

function tick() {
	temp = randomWalk(temp, 28, 72, 1.5);
	cpu = randomWalk(cpu, 1, 95, 5);
	memPercent = randomWalk(memPercent, 20, 90, 2);

	thermalHistory.push(+temp.toFixed(1));
	if (thermalHistory.length > 300) thermalHistory.shift();

	// Lock simulation: acquire/release randomly
	if (lockHolder) {
		const held = Date.now() - lockHolder.acquiredAt;
		if (held > 15_000 && Math.random() < 0.15) {
			lockHolder = null;
			lockCooldown = 10;
		}
	} else if (lockCooldown > 0) {
		lockCooldown--;
	} else if (Math.random() < 0.05) {
		lockHolder = {
			jobId: `job-${Math.random().toString(36).slice(2, 8)}`,
			runId: `run-${Math.floor(Math.random() * 9000 + 1000)}`,
			owner: ["acme/benchmark-suite", "myorg/perf-tests", "demo/load-test"][
				Math.floor(Math.random() * 3)
			],
			acquiredAt: Date.now(),
		};
	}
}

function buildStatusUpdate(requestId: string) {
	const trend =
		thermalHistory.length > 5
			? thermalHistory[thermalHistory.length - 1] - thermalHistory[thermalHistory.length - 5] > 1
				? "rising"
				: thermalHistory[thermalHistory.length - 5] - thermalHistory[thermalHistory.length - 1] > 1
					? "falling"
					: "stable"
			: "stable";

	const holder = lockHolder
		? {
				...lockHolder,
				duration: Date.now() - lockHolder.acquiredAt,
			}
		: null;

	return {
		type: "status.update",
		requestId,
		timestamp: Date.now(),
		lock: holder,
		queueDepth: holder ? Math.floor(Math.random() * 3) : 0,
		thermal: {
			currentTemp: +temp.toFixed(1),
			trend,
		},
		cpu: +cpu.toFixed(1),
		memory: {
			usedMb: Math.round((memPercent / 100) * memTotalMb),
			totalMb: memTotalMb,
			percent: +memPercent.toFixed(1),
		},
		uptime: Date.now() - startTime,
		system: {
			isolatedCores: [1, 2, 3],
			housekeepingCore: 0,
			totalCores: 4,
		},
	};
}

// --- Socket server ---

type Subscriber = { requestId: string; socket: Socket };
const subscribers: Subscriber[] = [];

function send(socket: Socket, msg: object) {
	try {
		socket.write(`${JSON.stringify(msg)}\n`);
	} catch {
		// client disconnected
	}
}

function handleMessage(
	socket: Socket,
	msg: { type: string; requestId: string; [k: string]: unknown },
) {
	switch (msg.type) {
		case "status.subscribe":
			subscribers.push({ requestId: msg.requestId, socket });
			// Send initial update immediately
			send(socket, buildStatusUpdate(msg.requestId));
			break;

		case "lock.status": {
			const holder = lockHolder
				? { ...lockHolder, duration: Date.now() - lockHolder.acquiredAt }
				: undefined;
			send(socket, {
				type: "lock.status",
				requestId: msg.requestId,
				held: !!lockHolder,
				holder,
				queueDepth: lockHolder ? Math.floor(Math.random() * 3) : 0,
			});
			break;
		}

		case "thermal.status":
			send(socket, {
				type: "thermal.status",
				requestId: msg.requestId,
				currentTemp: +temp.toFixed(1),
				history: thermalHistory.slice(-60),
				trend: "stable",
			});
			break;

		case "config.get":
			send(socket, {
				type: "config.get",
				requestId: msg.requestId,
				isolatedCores: [1, 2, 3],
				housekeepingCore: 0,
				totalCores: 4,
				thermalZones: ["/sys/class/thermal/thermal_zone0"],
				configPath: "/etc/benchd/config.toml",
			});
			break;

		default:
			send(socket, {
				type: "error",
				requestId: msg.requestId,
				code: "UNKNOWN_TYPE",
				message: `Mock does not handle: ${msg.type}`,
			});
	}
}

// Clean up stale socket
try {
	unlinkSync(SOCKET_PATH);
} catch {
	// doesn't exist
}

const server = createServer((socket) => {
	let buffer = "";

	socket.on("data", (data: Buffer) => {
		buffer += data.toString();
		let idx: number = buffer.indexOf("\n");
		while (idx !== -1) {
			const line = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 1);
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line);
				handleMessage(socket, msg);
			} catch {
				// malformed JSON
			}
			idx = buffer.indexOf("\n");
		}
	});

	socket.on("close", () => {
		// Remove subscribers for this socket
		for (let i = subscribers.length - 1; i >= 0; i--) {
			if (subscribers[i].socket === socket) {
				subscribers.splice(i, 1);
			}
		}
	});

	socket.on("error", () => {
		// ignore
	});
});

server.listen(SOCKET_PATH, () => {
	console.log(`Mock benchd listening on ${SOCKET_PATH}`);
	console.log("Test with:");
	console.log(`  bun packages/cli/src/index.ts status  --socket ${SOCKET_PATH}`);
	console.log(`  bun packages/cli/src/index.ts monitor --socket ${SOCKET_PATH}`);
});

// Tick simulation + push to subscribers
setInterval(() => {
	tick();
	for (let i = subscribers.length - 1; i >= 0; i--) {
		const sub = subscribers[i];
		try {
			send(sub.socket, buildStatusUpdate(sub.requestId));
		} catch {
			subscribers.splice(i, 1);
		}
	}
}, TICK_MS);

// Seed some initial history
for (let i = 0; i < 30; i++) tick();

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\nShutting down mock benchd...");
	server.close();
	try {
		unlinkSync(SOCKET_PATH);
	} catch {
		// already cleaned up
	}
	process.exit(0);
});
