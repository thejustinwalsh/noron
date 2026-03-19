import {
	ThermalRingBuffer,
	readCpuTemp,
	THERMAL_TIMEOUT_MS,
} from "@noron/shared";
import type {
	ThermalStatusRequest,
	ThermalWaitRequest,
} from "@noron/shared";
import type { ClientConnection } from "./connection";
import { log } from "./logger";

interface ThermalWaiter {
	client: ClientConnection;
	requestId: string;
	targetTemp: number;
	deadline: number;
}

/**
 * Monitors CPU temperature at a fixed interval.
 * Maintains a ring buffer of history and handles thermal.wait requests.
 */
export class ThermalMonitor {
	private history: ThermalRingBuffer;
	private interval: Timer | null = null;
	private waiters: ThermalWaiter[] = [];
	private _currentTemp: number | null = null;
	private idleBaseline: number | null = null;
	private stableStartedAt: number | null = null;
	private baselineSettlingMs: number;
	private thermalMarginC: number;

	constructor(
		private pollIntervalMs: number,
		private onUpdate: () => void,
		options?: { thermalMarginC?: number; baselineSettlingMs?: number },
	) {
		this.history = new ThermalRingBuffer();
		this.thermalMarginC = options?.thermalMarginC ?? 3;
		this.baselineSettlingMs = options?.baselineSettlingMs ?? 30000;
	}

	start(): void {
		this.poll(); // Immediate first read
		this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
	}

	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	waitForTarget(client: ClientConnection, msg: ThermalWaitRequest): void {
		const effectiveTarget = this.getEffectiveTarget(msg.targetTemp);
		const current = this._currentTemp;
		if (current !== null && current <= effectiveTarget) {
			client.send({
				type: "thermal.ready",
				requestId: msg.requestId,
				currentTemp: current,
			});
			return;
		}

		const timeout = msg.timeout ?? THERMAL_TIMEOUT_MS;
		this.waiters.push({
			client,
			requestId: msg.requestId,
			targetTemp: effectiveTarget,
			deadline: Date.now() + timeout,
		});

		log("info", "thermal", `Waiting for ${effectiveTarget}°C (current: ${current}°C, timeout: ${timeout}ms)`);
	}

	getStatus(client: ClientConnection, msg: ThermalStatusRequest): void {
		client.send({
			type: "thermal.status",
			requestId: msg.requestId,
			currentTemp: this._currentTemp ?? 0,
			history: this.history.toArray(),
			trend: this.currentTrend,
		});
	}

	get currentTemp(): number | null {
		return this._currentTemp;
	}

	get currentTrend(): "rising" | "falling" | "stable" {
		return this.history.trend();
	}

	getIdleBaseline(): number | null {
		return this.idleBaseline;
	}

	getEffectiveTarget(requestedTarget: number): number {
		// If requestedTarget > 0: use it as absolute (explicit override)
		// If requestedTarget === 0 and baseline established: return baseline + thermalMarginC
		// If requestedTarget === 0 and no baseline: return config default (45°C fallback)
		if (requestedTarget > 0) return requestedTarget;
		if (this.idleBaseline !== null) return this.idleBaseline + this.thermalMarginC;
		return 45; // fallback if no baseline yet
	}

	private poll(): void {
		const temp = readCpuTemp();
		if (temp !== null) {
			this._currentTemp = temp;
			this.history.push(temp);
			this.updateBaseline(temp);
			this.onUpdate();
		}

		// Always check waiter deadlines — even without a sensor,
		// thermal.wait requests must timeout so benchmarks proceed.
		this.checkWaiters(temp ?? 0);
	}

	private updateBaseline(currentTemp: number): void {
		const trend = this.history.trend();
		if (trend === "stable" && (this.idleBaseline === null || currentTemp <= this.idleBaseline)) {
			if (this.stableStartedAt === null) {
				this.stableStartedAt = Date.now();
			} else if (Date.now() - this.stableStartedAt >= this.baselineSettlingMs) {
				this.idleBaseline = currentTemp;
			}
		} else if (trend !== "stable") {
			this.stableStartedAt = null;
		}
	}

	private checkWaiters(temp: number): void {
		const now = Date.now();
		const remaining: ThermalWaiter[] = [];

		for (const waiter of this.waiters) {
			if (temp <= waiter.targetTemp) {
				waiter.client.send({
					type: "thermal.ready",
					requestId: waiter.requestId,
					currentTemp: temp,
				});
				log("info", "thermal", `Reached target ${waiter.targetTemp}°C (current: ${temp}°C)`);
			} else if (now >= waiter.deadline) {
				waiter.client.send({
					type: "thermal.timeout",
					requestId: waiter.requestId,
					currentTemp: temp,
					targetTemp: waiter.targetTemp,
				});
				log(
					"warn",
					"thermal",
					`Timeout waiting for ${waiter.targetTemp}°C (current: ${temp}°C)`,
				);
			} else {
				remaining.push(waiter);
			}
		}

		this.waiters = remaining;
	}
}
