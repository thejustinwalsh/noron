import { connect, type Socket } from "node:net";
import { existsSync } from "node:fs";
import { SOCKET_PATH } from "./constants";
import type {
	BaseRequest,
	ErrorResponse,
	Request,
	Response,
	ResponseFor,
	StatusUpdate,
	ViolationEvent,
} from "./protocol";

type PendingRequest = {
	resolve: (value: Response) => void;
	reject: (error: Error) => void;
};

/**
 * Client for communicating with the benchd daemon over a Unix socket.
 * Uses line-delimited JSON protocol with request/response correlation.
 */
export class BenchdClient {
	private socket: Socket | null = null;
	private pending = new Map<string, PendingRequest>();
	private subscribers = new Map<string, (msg: StatusUpdate) => void>();
	private violationHandlers = new Set<(event: ViolationEvent) => void>();
	private buffer = "";
	private connected = false;

	constructor(private socketPath: string = SOCKET_PATH) {}

	/** Connect to the benchd daemon */
	async connect(): Promise<void> {
		if (this.connected) return;

		// Pre-check: avoid Bun crash where net.connect() throws
		// an uncatchable error from afterConnect on missing sockets
		if (!existsSync(this.socketPath)) {
			throw new Error(`benchd socket not found: ${this.socketPath}`);
		}

		return new Promise((resolve, reject) => {
			const socket = connect({ path: this.socketPath });

			// Register error handler FIRST — Bun may emit errors synchronously
			socket.on("error", (err: Error) => {
				if (!this.connected) {
					reject(err);
				}
			});

			socket.on("connect", () => {
				this.socket = socket;
				this.connected = true;
				resolve();
			});

			socket.on("data", (data: Buffer) => {
				this.buffer += data.toString();
				this.processBuffer();
			});

			socket.on("close", () => {
				this.connected = false;
				this.socket = null;
				// Reject all pending requests
				for (const [, req] of this.pending) {
					req.reject(new Error("Connection closed"));
				}
				this.pending.clear();
			});
		});
	}

	/** Send a request and wait for the correlated response */
	async request<T extends Request>(msg: T): Promise<ResponseFor<T>> {
		if (!this.socket || !this.connected) {
			throw new Error("Not connected to benchd");
		}

		return new Promise((resolve, reject) => {
			this.pending.set(msg.requestId, {
				resolve: resolve as (value: Response) => void,
				reject,
			});
			this.send(msg);
		});
	}

	/** Subscribe to status updates. Returns an unsubscribe function. */
	subscribe(callback: (update: StatusUpdate) => void): () => void {
		const requestId = crypto.randomUUID();
		this.subscribers.set(requestId, callback);

		const msg: BaseRequest & { type: "status.subscribe" } = {
			type: "status.subscribe",
			requestId,
		};
		this.send(msg);

		return () => {
			this.subscribers.delete(requestId);
		};
	}

	/** Register a handler for violation events. Returns an unregister function. */
	onViolation(callback: (event: ViolationEvent) => void): () => void {
		this.violationHandlers.add(callback);
		return () => {
			this.violationHandlers.delete(callback);
		};
	}

	/** Close the connection */
	close(): void {
		if (this.socket) {
			this.socket.end();
			this.socket = null;
			this.connected = false;
		}
	}

	get isConnected(): boolean {
		return this.connected;
	}

	private send(msg: object): void {
		if (!this.socket) return;
		this.socket.write(`${JSON.stringify(msg)}\n`);
	}

	private processBuffer(): void {
		let newlineIdx: number;
		while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, newlineIdx);
			this.buffer = this.buffer.slice(newlineIdx + 1);

			if (!line.trim()) continue;

			try {
				const msg = JSON.parse(line) as Response;
				this.handleMessage(msg);
			} catch {
				// Malformed JSON — skip
			}
		}
	}

	private handleMessage(msg: Response): void {
		// Status updates go to subscribers
		if (msg.type === "status.update") {
			const sub = this.subscribers.get(msg.requestId);
			if (sub) sub(msg as StatusUpdate);
			return;
		}

		// Violation events go to violation handlers
		if (msg.type === "violation.occurred") {
			for (const handler of this.violationHandlers) {
				handler(msg as ViolationEvent);
			}
			return;
		}

		// lock.queued is an intermediate response — keep the promise pending
		// until lock.acquired arrives with the same requestId
		if (msg.type === "lock.queued") {
			return;
		}

		// Correlated response
		const pending = this.pending.get(msg.requestId);
		if (pending) {
			this.pending.delete(msg.requestId);
			if (msg.type === "error") {
				pending.reject(new Error((msg as ErrorResponse).message));
			} else {
				pending.resolve(msg);
			}
		}
	}
}
