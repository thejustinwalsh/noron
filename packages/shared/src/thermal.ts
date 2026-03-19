import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { THERMAL_HISTORY_SIZE } from "./constants";

/**
 * Fixed-size ring buffer for thermal readings.
 * Uses Float32Array for minimal memory footprint.
 */
export class ThermalRingBuffer {
	private buffer: Float32Array;
	private head = 0;
	private count = 0;

	constructor(private capacity: number = THERMAL_HISTORY_SIZE) {
		this.buffer = new Float32Array(capacity);
	}

	push(tempC: number): void {
		this.buffer[this.head] = tempC;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}

	latest(): number | null {
		if (this.count === 0) return null;
		const idx = (this.head - 1 + this.capacity) % this.capacity;
		return this.buffer[idx];
	}

	/** Returns readings oldest-first */
	toArray(): number[] {
		if (this.count === 0) return [];
		const result: number[] = new Array(this.count);
		const start = this.count < this.capacity ? 0 : this.head;
		for (let i = 0; i < this.count; i++) {
			result[i] = this.buffer[(start + i) % this.capacity];
		}
		return result;
	}

	/** Average of the last N readings */
	average(n: number): number | null {
		if (this.count === 0) return null;
		const take = Math.min(n, this.count);
		let sum = 0;
		for (let i = 0; i < take; i++) {
			const idx = (this.head - 1 - i + this.capacity) % this.capacity;
			sum += this.buffer[idx];
		}
		return sum / take;
	}

	/** Determine trend from last N readings */
	trend(n = 10): "rising" | "falling" | "stable" {
		if (this.count < 2) return "stable";
		const take = Math.min(n, this.count);
		const first = this.buffer[(this.head - take + this.capacity) % this.capacity];
		const last = this.buffer[(this.head - 1 + this.capacity) % this.capacity];
		const diff = last - first;
		if (diff > 0.5) return "rising";
		if (diff < -0.5) return "falling";
		return "stable";
	}

	get size(): number {
		return this.count;
	}
}

/**
 * Find the CPU thermal zone on Linux.
 * Returns the sysfs path to the temp file, or null on non-Linux / missing sensor.
 */
function findCpuThermalZone(): string | null {
	const base = "/sys/class/thermal";
	if (!existsSync(base)) return null;

	try {
		const zones = readdirSync(base).filter((d) => d.startsWith("thermal_zone"));
		for (const zone of zones) {
			const typePath = `${base}/${zone}/type`;
			if (existsSync(typePath)) {
				const type = readFileSync(typePath, "utf-8").trim();
				// Prefer x86_pkg_temp or coretemp zones for CPU temp
				if (
					type.includes("x86_pkg") ||
					type.includes("coretemp") ||
					type.includes("cpu")
				) {
					return `${base}/${zone}/temp`;
				}
			}
		}
		// Fallback to zone 0 if no CPU-specific zone found
		const fallback = `${base}/thermal_zone0/temp`;
		if (existsSync(fallback)) return fallback;
	} catch {
		// Permission denied or other fs error
	}
	return null;
}

/**
 * Read per-core thermal throttle counts from sysfs.
 * Returns Map<coreId, count> or null if not available (e.g., macOS).
 */
export function readThrottleCounts(): Map<number, number> | null {
	const base = "/sys/devices/system/cpu";
	if (!existsSync(base)) return null;

	try {
		const cpuDirs = readdirSync(base).filter((d) => /^cpu\d+$/.test(d));
		const counts = new Map<number, number>();

		for (const dir of cpuDirs) {
			const countPath = `${base}/${dir}/thermal_throttle/core_throttle_count`;
			if (!existsSync(countPath)) continue;
			try {
				const raw = readFileSync(countPath, "utf-8").trim();
				const count = Number.parseInt(raw, 10);
				if (!Number.isNaN(count)) {
					const coreId = Number.parseInt(dir.slice(3), 10);
					counts.set(coreId, count);
				}
			} catch {
				// Permission denied or read error — skip this core
			}
		}

		return counts.size > 0 ? counts : null;
	} catch {
		return null;
	}
}

let cachedThermalPath: string | null | undefined;

/**
 * Read current CPU temperature in Celsius.
 * Returns null if no thermal sensor is available (e.g., macOS development).
 */
export function readCpuTemp(): number | null {
	if (cachedThermalPath === undefined) {
		cachedThermalPath = findCpuThermalZone();
	}
	if (cachedThermalPath === null) return null;

	try {
		const raw = readFileSync(cachedThermalPath, "utf-8").trim();
		const millidegrees = Number.parseInt(raw, 10);
		if (Number.isNaN(millidegrees)) return null;
		return millidegrees / 1000;
	} catch {
		return null;
	}
}
