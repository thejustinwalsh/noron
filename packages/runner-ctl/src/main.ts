import { chmodSync, chownSync, existsSync, statSync, unlinkSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { type RunnerRequest, type RunnerResponse, dispatch } from "./handlers";

const SOCKET_PATH = process.env.RUNNER_CTL_SOCKET ?? "/var/run/runner-ctl.sock";
const MAX_LINE_LENGTH = 1024 * 1024; // 1 MB — reject oversized payloads

let server: Server | null = null;
const clients = new Set<Socket>();

function log(level: string, msg: string): void {
	const ts = new Date().toISOString();
	console.log(`${ts} [${level}] ${msg}`);
}

/** Resolve the bench group GID. Returns null if the group doesn't exist. */
function benchGid(): number | null {
	try {
		// /etc/group format: name:x:gid:members
		const content = require("node:fs").readFileSync("/etc/group", "utf-8") as string;
		for (const line of content.split("\n")) {
			const parts = line.split(":");
			if (parts[0] === "bench") return Number(parts[2]);
		}
	} catch {
		// /etc/group unreadable
	}
	return null;
}

function handleConnection(socket: Socket): void {
	clients.add(socket);
	let buffer = "";

	socket.on("data", (data: Buffer) => {
		buffer += data.toString();
		if (buffer.length > MAX_LINE_LENGTH) {
			socket.write(
				`${JSON.stringify({ requestId: "", type: "error", code: "payload_too_large", message: "Request exceeds maximum size" })}\n`,
			);
			socket.destroy();
			clients.delete(socket);
			return;
		}
		for (let idx = buffer.indexOf("\n"); idx !== -1; idx = buffer.indexOf("\n")) {
			const line = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 1);
			if (!line.trim()) continue;
			handleLine(socket, line);
		}
	});

	socket.on("close", () => {
		clients.delete(socket);
	});

	socket.on("error", () => {
		clients.delete(socket);
	});
}

async function handleLine(socket: Socket, line: string): Promise<void> {
	let msg: RunnerRequest;
	try {
		msg = JSON.parse(line);
	} catch {
		const err: RunnerResponse = {
			requestId: "",
			type: "error",
			code: "parse_error",
			message: "Invalid JSON",
		};
		socket.write(`${JSON.stringify(err)}\n`);
		return;
	}

	try {
		const response = await dispatch(msg);
		socket.write(`${JSON.stringify(response)}\n`);
	} catch (err) {
		const errResponse: RunnerResponse = {
			requestId: msg.requestId ?? "",
			type: "error",
			code: "handler_error",
			message: err instanceof Error ? err.message : String(err),
		};
		socket.write(`${JSON.stringify(errResponse)}\n`);
	}
}

function shutdown(): void {
	log("info", "Shutting down...");
	for (const client of clients) {
		client.destroy();
	}
	if (server) {
		server.close(() => {
			if (existsSync(SOCKET_PATH)) {
				unlinkSync(SOCKET_PATH);
			}
			process.exit(0);
		});
	} else {
		process.exit(0);
	}
}

// Remove stale socket
if (existsSync(SOCKET_PATH)) {
	unlinkSync(SOCKET_PATH);
}

// Set restrictive umask before creating socket — prevents race condition
// where connections arrive before permissions are set
const prevUmask = process.umask(0o007);

server = createServer(handleConnection);

server.listen(SOCKET_PATH, () => {
	process.umask(prevUmask);

	// Secure the socket: root:bench, mode 0770
	const gid = benchGid();
	if (gid !== null) {
		chownSync(SOCKET_PATH, 0, gid);
		chmodSync(SOCKET_PATH, 0o770);
	} else {
		// No bench group — refuse to run with insecure permissions
		log("error", "bench group not found — cannot secure socket. Exiting.");
		process.exit(1);
	}

	log("info", `runner-ctld listening on ${SOCKET_PATH}`);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
