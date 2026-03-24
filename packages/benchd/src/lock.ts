import { randomBytes } from "node:crypto";
import { LOCK_DISCONNECT_GRACE_MS } from "@noron/shared";
import type {
	LockAcquireRequest,
	LockAcquiredResponse,
	LockHolder,
	LockReleaseRequest,
	LockStatusRequest,
} from "@noron/shared";
import type { ClientConnection } from "./connection";
import { log } from "./logger";

interface ActiveLock {
	client: ClientConnection;
	jobId: string;
	runId: string;
	owner: string;
	acquiredAt: number;
	jobToken: string;
	actionInvoked: boolean;
	timeoutTimer: Timer | null;
	effectiveTimeoutMs: number;
}

interface QueuedLock {
	client: ClientConnection;
	request: LockAcquireRequest;
	queuedAt: number;
}

export interface LockTimeoutHandler {
	onTimeout(lock: ActiveLock): void;
}

/**
 * Machine-wide job lock. Only one job at a time, FIFO queue for waiters.
 * Auto-releases if the lock holder disconnects.
 *
 * Security: generates a cryptographic jobToken per lock grant.
 * Privileged IPC operations must present a valid token.
 */
export class LockManager {
	private holder: ActiveLock | null = null;
	private queue: QueuedLock[] = [];
	private disconnectTimers = new Map<ClientConnection, Timer>();

	constructor(
		private onChange: () => void,
		private jobTimeoutMs: number,
		private onTimeout?: (owner: string, jobId: string, runId: string) => void,
		private onViolation?: (
			repo: string,
			jobId: string,
			runId: string,
			reason: "action_not_used" | "job_timeout",
		) => void,
	) {}

	acquire(client: ClientConnection, msg: LockAcquireRequest): void {
		if (!this.holder) {
			this.grantLock(client, msg, 0);
		} else {
			const position = this.queue.length + 1;
			this.queue.push({ client, request: msg, queuedAt: Date.now() });
			client.send({
				type: "lock.queued",
				requestId: msg.requestId,
				position,
			});
			log("info", "lock", `Job ${msg.jobId} queued at position ${position}`, {
				owner: msg.owner,
			});
		}
	}

	release(client: ClientConnection, msg: LockReleaseRequest): void {
		if (!this.holder || this.holder.jobId !== msg.jobId) {
			client.send({
				type: "error",
				requestId: msg.requestId,
				code: this.holder ? "lock.wrong_owner" : "lock.not_held",
				message: this.holder
					? `Lock held by job ${this.holder.jobId}, not ${msg.jobId}`
					: "No lock is currently held",
			});
			return;
		}

		// Validate job token
		if (msg.jobToken !== this.holder.jobToken) {
			client.send({
				type: "error",
				requestId: msg.requestId,
				code: "auth.invalid_token",
				message: "Invalid job token for lock release",
			});
			return;
		}

		const duration = Date.now() - this.holder.acquiredAt;
		const actionInvoked = this.holder.actionInvoked;
		const { owner, runId } = this.holder;

		log("info", "lock", `Job ${msg.jobId} released lock`, {
			owner,
			duration,
			actionInvoked,
		});

		// Determine violation
		let violation: "action_not_used" | undefined;
		if (!actionInvoked) {
			violation = "action_not_used";
			log("warn", "lock", `Violation: action not used by ${owner} job ${msg.jobId}`);
		}

		this.clearTimeout();
		this.holder = null;
		client.send({
			type: "lock.released",
			requestId: msg.requestId,
			violation,
		});

		// Broadcast violation to subscribers (bench-web records in DB)
		if (violation) {
			this.onViolation?.(owner, msg.jobId, runId, violation);
		}

		this.grantNext();
		this.onChange();
	}

	/**
	 * Force-release the lock due to timeout.
	 * Called by the timeout timer — kills processes and releases.
	 */
	forceRelease(): void {
		if (!this.holder) return;

		const { jobId, runId, owner } = this.holder;
		log("warn", "lock", `Job ${jobId} timed out after ${this.getEffectiveTimeout()}ms`, {
			owner,
		});

		this.onTimeout?.(owner, jobId, runId);
		this.onViolation?.(owner, jobId, runId, "job_timeout");

		this.clearTimeout();
		this.holder = null;
		this.grantNext();
		this.onChange();
	}

	/** Validate a job token against the current lock holder */
	validateToken(token: string): boolean {
		return this.holder !== null && this.holder.jobToken === token;
	}

	/** Mark that the noron action was invoked for the current job */
	markActionInvoked(jobToken: string): boolean {
		if (!this.holder || this.holder.jobToken !== jobToken) return false;
		this.holder.actionInvoked = true;
		log("info", "lock", `Action checked in for job ${this.holder.jobId}`, {
			owner: this.holder.owner,
		});
		return true;
	}

	/** Get the current lock holder's owner (repo slug) */
	get currentOwner(): string | null {
		return this.holder?.owner ?? null;
	}

	getStatus(client: ClientConnection, msg: LockStatusRequest): void {
		client.send({
			type: "lock.status",
			requestId: msg.requestId,
			held: this.holder !== null,
			holder: this.currentHolder ?? undefined,
			queueDepth: this.queue.length,
		});
	}

	/** Handle client disconnect — the job-started hook is a short-lived process
	 *  that acquires the lock, writes the token, and exits. This is expected.
	 *  The lock is released by the job-completed hook via a separate connection
	 *  using the job token. The job timeout is the safety net for abandoned locks. */
	handleDisconnect(client: ClientConnection): void {
		// Remove from queue
		this.queue = this.queue.filter((q) => q.client !== client);

		// Lock holder disconnecting is normal — the hook process exited after
		// writing the token. The lock stays held and is released by job-completed.
		// The job timeout handles the case where job-completed never fires.
		if (this.holder?.client === client) {
			log("info", "lock", `Lock holder disconnected (job ${this.holder.jobId}) — lock stays held until release or timeout`);
		}
	}

	get currentHolder(): LockHolder | null {
		if (!this.holder) return null;
		return {
			jobId: this.holder.jobId,
			runId: this.holder.runId,
			owner: this.holder.owner,
			acquiredAt: this.holder.acquiredAt,
			duration: Date.now() - this.holder.acquiredAt,
			timeoutMs: this.holder.effectiveTimeoutMs,
		};
	}

	get queueDepth(): number {
		return this.queue.length;
	}

	/** Update the timeout for the current lock (e.g. per-repo override) */
	setCurrentTimeout(timeoutMs: number): void {
		if (!this.holder) return;
		this.clearTimeout();
		this.holder.effectiveTimeoutMs = timeoutMs;
		this.holder.timeoutTimer = setTimeout(() => this.forceRelease(), timeoutMs);
	}

	private getEffectiveTimeout(): number {
		return this.jobTimeoutMs;
	}

	private grantLock(client: ClientConnection, msg: LockAcquireRequest, position: number): void {
		const jobToken = randomBytes(32).toString("hex");

		const effectiveTimeout = this.getEffectiveTimeout();
		this.holder = {
			client,
			jobId: msg.jobId,
			runId: msg.runId,
			owner: msg.owner,
			acquiredAt: Date.now(),
			jobToken,
			actionInvoked: false,
			timeoutTimer: null,
			effectiveTimeoutMs: effectiveTimeout,
		};

		// Start job timeout timer
		this.holder.timeoutTimer = setTimeout(() => this.forceRelease(), effectiveTimeout);

		const response: LockAcquiredResponse = {
			type: "lock.acquired",
			requestId: msg.requestId,
			position,
			jobToken,
		};
		client.send(response);
		log("info", "lock", `Job ${msg.jobId} acquired lock`, {
			owner: msg.owner,
		});
		this.onChange();
	}

	private clearTimeout(): void {
		if (this.holder?.timeoutTimer) {
			clearTimeout(this.holder.timeoutTimer);
			this.holder.timeoutTimer = null;
		}
	}

	private grantNext(): void {
		if (this.queue.length === 0) return;
		const next = this.queue.shift() as QueuedLock;
		this.grantLock(next.client, next.request, 1);
	}
}
