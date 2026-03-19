import type { Socket } from "node:net";
import type { Request, Response } from "@noron/shared";

/**
 * Wraps a raw TCP/Unix socket with line-delimited JSON framing.
 * Each message is a single JSON object followed by \n.
 */
export class ClientConnection {
	private buffer = "";
	/** The requestId used for status subscriptions (if subscribed) */
	subscriptionRequestId: string | null = null;

	constructor(
		private socket: Socket,
		private onMessage: (msg: Request) => void,
	) {
		socket.on("data", (data: Buffer) => {
			this.buffer += data.toString();
			this.processBuffer();
		});

		socket.on("error", () => {
			// Handled by the close event in the server
		});
	}

	send(msg: Response | object): void {
		if (this.socket.writable) {
			this.socket.write(`${JSON.stringify(msg)}\n`);
		}
	}

	close(): void {
		this.socket.end();
	}

	get id(): string {
		return `${this.socket.remoteAddress ?? "local"}:${this.socket.remotePort ?? 0}`;
	}

	private processBuffer(): void {
		let newlineIdx: number = this.buffer.indexOf("\n");
		while (newlineIdx !== -1) {
			const line = this.buffer.slice(0, newlineIdx);
			this.buffer = this.buffer.slice(newlineIdx + 1);

			if (!line.trim()) continue;

			try {
				const msg = JSON.parse(line) as Request;
				// Track subscription requestId
				if (msg.type === "status.subscribe") {
					this.subscriptionRequestId = msg.requestId;
				}
				this.onMessage(msg);
			} catch {
				this.send({
					type: "error",
					requestId: "",
					code: "parse_error",
					message: "Invalid JSON",
				});
			}
			newlineIdx = this.buffer.indexOf("\n");
		}
	}
}
