import type { BenchGate } from "./bench-gate";

export interface ScheduledTask {
	name: string;
	fn: () => Promise<void>;
	intervalMs: number;
	initialDelayMs?: number;
}

interface TaskEntry {
	task: ScheduledTask;
	timer: ReturnType<typeof setTimeout> | null;
	running: boolean;
}

/**
 * Manages deferrable (Category 2) tasks that should not run during benchmarks.
 * Uses setTimeout chains for precise control. Pauses when gate closes,
 * resumes with short jitter when gate opens.
 */
export class BenchScheduler {
	private _tasks = new Map<string, TaskEntry>();
	private _unsubscribe: (() => void) | null = null;
	private _disposed = false;

	constructor(private _gate: BenchGate) {
		this._unsubscribe = this._gate.on("stateChange", (_from, to) => {
			if (to === "draining" || to === "locked") {
				this._pauseAll();
			} else if (to === "open") {
				this._resumeAll();
			}
		});
	}

	/** Register a periodic task. */
	register(task: ScheduledTask): void {
		if (this._disposed) return;

		const entry: TaskEntry = {
			task,
			timer: null,
			running: false,
		};

		this._tasks.set(task.name, entry);

		// Only schedule if gate is currently open
		if (this._gate.state === "open") {
			this._scheduleNext(entry, task.initialDelayMs ?? task.intervalMs);
		}
	}

	/** Remove a task. */
	unregister(name: string): void {
		const entry = this._tasks.get(name);
		if (!entry) return;

		if (entry.timer !== null) {
			clearTimeout(entry.timer);
			entry.timer = null;
		}
		this._tasks.delete(name);
	}

	/** Clean up all timers and subscriptions. */
	dispose(): void {
		this._disposed = true;
		for (const [, entry] of this._tasks) {
			if (entry.timer !== null) {
				clearTimeout(entry.timer);
				entry.timer = null;
			}
		}
		this._tasks.clear();
		if (this._unsubscribe) {
			this._unsubscribe();
			this._unsubscribe = null;
		}
	}

	private _scheduleNext(entry: TaskEntry, delayMs: number): void {
		if (this._disposed) return;

		entry.timer = setTimeout(async () => {
			entry.timer = null;

			// Check gate state before running — skip if not open
			if (this._gate.state !== "open") return;

			// Prevent overlapping executions
			if (entry.running) return;

			entry.running = true;
			try {
				await entry.task.fn();
			} catch (err) {
				console.error(`[bench-scheduler] Task "${entry.task.name}" failed:`, err);
			} finally {
				entry.running = false;
			}

			// Reschedule if still registered and gate is open
			if (this._tasks.has(entry.task.name) && this._gate.state === "open") {
				this._scheduleNext(entry, entry.task.intervalMs);
			}
		}, delayMs);
	}

	private _pauseAll(): void {
		for (const [, entry] of this._tasks) {
			if (entry.timer !== null) {
				clearTimeout(entry.timer);
				entry.timer = null;
			}
		}
	}

	private _resumeAll(): void {
		for (const [, entry] of this._tasks) {
			if (entry.timer !== null) continue; // Already scheduled
			if (entry.running) continue; // Currently executing — will reschedule itself

			// Short jitter (1-2s) so tasks run soon after benchmark completes
			const jitter = 1000 + Math.random() * 1000;
			this._scheduleNext(entry, jitter);
		}
	}
}
