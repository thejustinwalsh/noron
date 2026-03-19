export type GateState = "open" | "draining" | "locked";

export interface GatePass {
	signal: AbortSignal;
	exit: () => void;
}

export interface GateSnapshot {
	state: GateState;
	activeOps: number;
	holder?: string;
}

type GateEventMap = {
	stateChange: (from: GateState, to: GateState) => void;
	drainTimeout: (level: "soft" | "hard", activeOps: number) => void;
};

/**
 * Two-way coordination primitive for benchmark isolation.
 *
 * State machine: OPEN → DRAINING → LOCKED → OPEN
 *
 * - OPEN: I/O allowed. enterGate() resolves immediately, increments activeOps.
 * - DRAINING: New I/O blocked. In-flight ops tracked. Resolves when activeOps → 0.
 * - LOCKED: Benchmark running. All enterGate() calls block until openGate().
 */
export class BenchGate {
	private _state: GateState = "open";
	private _activeOps = 0;
	private _holder?: string;

	/** Promise that resolves when the gate opens (used by enterGate waiters) */
	private _gatePromise: Promise<void> | null = null;
	private _gateResolve: (() => void) | null = null;

	/** Promise that resolves when drain completes (used by closeGate caller) */
	private _drainPromise: Promise<void> | null = null;
	private _drainResolve: (() => void) | null = null;

	private _softTimer: ReturnType<typeof setTimeout> | null = null;
	private _hardTimer: ReturnType<typeof setTimeout> | null = null;

	/** AbortControllers for active GatePasses — fired on hard deadline */
	private _activeAborts = new Set<AbortController>();

	// biome-ignore lint: any needed for generic event map
	private _listeners: Record<string, Set<any>> = {};

	constructor(
		private softDeadlineMs = 30_000,
		private hardDeadlineMs = 120_000,
	) {}

	get state(): GateState {
		return this._state;
	}

	get activeOps(): number {
		return this._activeOps;
	}

	snapshot(): GateSnapshot {
		return {
			state: this._state,
			activeOps: this._activeOps,
			holder: this._holder,
		};
	}

	/**
	 * Benchmark lock acquired — stop new I/O, drain in-flight ops.
	 * Returns a promise that resolves when drain completes (or hard deadline forces it).
	 */
	async closeGate(holder?: string): Promise<void> {
		if (this._state === "locked") return;

		// If already draining, join existing drain
		if (this._state === "draining") {
			if (this._drainPromise) return this._drainPromise;
			return;
		}

		this._holder = holder;

		// Create gate promise to block enterGate() callers
		if (!this._gatePromise) {
			this._gatePromise = new Promise<void>((resolve) => {
				this._gateResolve = resolve;
			});
		}

		// If no active ops, skip directly to LOCKED
		if (this._activeOps === 0) {
			this._transition("draining");
			this._transition("locked");
			return;
		}

		// Enter DRAINING — wait for in-flight ops
		this._transition("draining");

		this._drainPromise = new Promise<void>((resolve) => {
			this._drainResolve = resolve;
		});

		// Start soft deadline timer
		this._softTimer = setTimeout(() => {
			this._emit("drainTimeout", "soft", this._activeOps);
		}, this.softDeadlineMs);

		// Start hard deadline timer
		this._hardTimer = setTimeout(() => {
			this._emit("drainTimeout", "hard", this._activeOps);
			this._forceCompleteDrain();
		}, this.hardDeadlineMs);

		return this._drainPromise;
	}

	/**
	 * Benchmark lock released — unblock all waiting operations.
	 */
	openGate(): void {
		if (this._state === "open") return;

		this._clearTimers();
		this._holder = undefined;

		// If draining, force-complete it first
		if (this._state === "draining" && this._drainResolve) {
			this._drainResolve();
			this._drainResolve = null;
			this._drainPromise = null;
		}

		this._transition("open");

		// Resolve gate promise — all blocked enterGate() calls resume
		if (this._gateResolve) {
			this._gateResolve();
			this._gateResolve = null;
			this._gatePromise = null;
		}
	}

	/**
	 * Workflow step calls this before I/O — blocks if gate is closed.
	 * Returns a GatePass with an AbortSignal (fires on hard deadline)
	 * and an exit() function to call when I/O completes.
	 */
	async enterGate(): Promise<GatePass> {
		// If gate is not open, wait for it
		if (this._state !== "open") {
			if (this._gatePromise) {
				await this._gatePromise;
			}
		}

		this._activeOps++;

		const ac = new AbortController();
		this._activeAborts.add(ac);

		const pass: GatePass = {
			signal: ac.signal,
			exit: () => {
				// Safe no-op if already exited or force-closed
				if (!this._activeAborts.delete(ac)) return;
				this._activeOps--;
				this._checkDrainComplete();
			},
		};

		return pass;
	}

	/**
	 * Observe state changes and drain timeouts.
	 * Returns an unsubscribe function.
	 */
	on<K extends keyof GateEventMap>(event: K, handler: GateEventMap[K]): () => void {
		if (!this._listeners[event]) {
			this._listeners[event] = new Set();
		}
		this._listeners[event].add(handler);
		return () => {
			this._listeners[event]?.delete(handler);
		};
	}

	private _emit<K extends keyof GateEventMap>(event: K, ...args: Parameters<GateEventMap[K]>): void {
		const listeners = this._listeners[event];
		if (!listeners) return;
		for (const handler of listeners) {
			handler(...args);
		}
	}

	private _transition(to: GateState): void {
		const from = this._state;
		this._state = to;
		this._emit("stateChange", from, to);
	}

	private _checkDrainComplete(): void {
		if (this._state !== "draining") return;
		if (this._activeOps > 0) return;

		this._clearTimers();
		this._transition("locked");

		if (this._drainResolve) {
			this._drainResolve();
			this._drainResolve = null;
			this._drainPromise = null;
		}
	}

	private _forceCompleteDrain(): void {
		// Fire AbortSignal on all active GatePasses
		for (const ac of this._activeAborts) {
			ac.abort(new Error("Bench gate hard deadline exceeded"));
		}

		this._clearTimers();
		this._activeOps = 0;
		this._activeAborts.clear();
		this._transition("locked");

		if (this._drainResolve) {
			this._drainResolve();
			this._drainResolve = null;
			this._drainPromise = null;
		}
	}

	private _clearTimers(): void {
		if (this._softTimer) {
			clearTimeout(this._softTimer);
			this._softTimer = null;
		}
		if (this._hardTimer) {
			clearTimeout(this._hardTimer);
			this._hardTimer = null;
		}
	}
}
