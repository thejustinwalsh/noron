import { type Socket, connect } from "node:net";

/** Default socket path for runner-ctld */
export const RUNNER_CTL_SOCKET = "/var/run/runner-ctl.sock";

export interface RunnerCtlRequest {
	type: "provision" | "deprovision" | "status";
	requestId: string;
	[key: string]: unknown;
}

export interface RunnerCtlResponse {
	requestId: string;
	type: "provisioned" | "deprovisioned" | "status" | "error";
	[key: string]: unknown;
}

/**
 * Lightweight IPC client for runner-ctld.
 * Sends line-delimited JSON, correlates responses by requestId.
 */
export class RunnerCtlClient {
	private socket: Socket | null = null;
	private buffer = "";
	private pending = new Map<
		string,
		{ resolve: (v: RunnerCtlResponse) => void; reject: (e: Error) => void }
	>();
	private socketPath: string;

	constructor(socketPath?: string) {
		this.socketPath = socketPath ?? process.env.RUNNER_CTL_SOCKET ?? RUNNER_CTL_SOCKET;
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket = connect(this.socketPath, () => resolve());
			this.socket.on("error", (err) => {
				reject(err);
				// Reject all pending requests
				for (const [, p] of this.pending) {
					p.reject(err);
				}
				this.pending.clear();
			});
			this.socket.on("data", (data: Buffer) => {
				this.buffer += data.toString();
				for (let idx = this.buffer.indexOf("\n"); idx !== -1; idx = this.buffer.indexOf("\n")) {
					const line = this.buffer.slice(0, idx);
					this.buffer = this.buffer.slice(idx + 1);
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line) as RunnerCtlResponse;
						const p = this.pending.get(msg.requestId);
						if (p) {
							this.pending.delete(msg.requestId);
							if (msg.type === "error") {
								p.reject(new Error((msg as { message?: string }).message ?? "runner-ctld error"));
							} else {
								p.resolve(msg);
							}
						}
					} catch {
						// ignore malformed responses
					}
				}
			});
		});
	}

	request(msg: RunnerCtlRequest): Promise<RunnerCtlResponse> {
		const socket = this.socket;
		if (!socket) throw new Error("Not connected to runner-ctld");
		return new Promise((resolve, reject) => {
			this.pending.set(msg.requestId, { resolve, reject });
			socket.write(`${JSON.stringify(msg)}\n`);
		});
	}

	close(): void {
		this.socket?.destroy();
		this.socket = null;
		for (const [, p] of this.pending) {
			p.reject(new Error("Connection closed"));
		}
		this.pending.clear();
	}
}
