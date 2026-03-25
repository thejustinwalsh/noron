import { THERMAL_TIMEOUT_MS } from "@noron/shared";
import type { ThermalSensor, ThermalStatusRequest, ThermalWaitRequest } from "@noron/shared";
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
 * Delegates all storage and reading to a ThermalSensor instance.
 */
export class ThermalMonitor {
	private interval: Timer | null = null;
	private waiters: ThermalWaiter[] = [];
	private idleBaseline: number | null = null;
	private stableStartedAt: number | null = null;
	private baselineSettlingMs: number;
	private thermalMarginC: number;

	constructor(
		private pollIntervalMs: number,
		private store: ThermalSensor,
		private onUpdate: () => void,
		options?: { thermalMarginC?: number; baselineSettlingMs?: number },
	) {
		this.thermalMarginC = options?.thermalMarginC ?? 3;
		this.baselineSettlingMs = options?.baselineSettlingMs ?? 30000;
	}

	start(): void {
		this.poll();
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
		const current = this.store.currentTemp;
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

		log(
			"info",
			"thermal",
			`Waiting for ${effectiveTarget}°C (current: ${current}°C, timeout: ${timeout}ms)`,
		);
	}

	getStatus(client: ClientConnection, msg: ThermalStatusRequest): void {
		client.send({
			type: "thermal.status",
			requestId: msg.requestId,
			currentTemp: this.store.currentTemp ?? 0,
			history: this.store.toArray(),
			trend: this.currentTrend,
		});
	}

	get currentTemp(): number | null {
		return this.store.currentTemp;
	}

	get currentTrend(): "rising" | "falling" | "stable" {
		return this.store.trend();
	}

	getIdleBaseline(): number | null {
		return this.idleBaseline;
	}

	getEffectiveTarget(requestedTarget: number): number {
		if (requestedTarget > 0) return requestedTarget;
		if (this.idleBaseline !== null) return this.idleBaseline + this.thermalMarginC;
		return 45;
	}

	private poll(): void {
		const temp = this.store.poll();
		if (temp !== null) {
			this.updateBaseline(temp);
		}

		this.onUpdate();
		this.checkWaiters(temp ?? 0);
	}

	private updateBaseline(currentTemp: number): void {
		const trend = this.store.trend();
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
				log("warn", "thermal", `Timeout waiting for ${waiter.targetTemp}°C (current: ${temp}°C)`);
			} else {
				remaining.push(waiter);
			}
		}

		this.waiters = remaining;
	}
}
