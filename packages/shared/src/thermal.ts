import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { THERMAL_HISTORY_SIZE } from "./constants";

/**
 * Unified thermal sensor + ring buffer + backfill store.
 *
 * All thermal data flows through this single structure:
 * - FFI pread() reads millidegrees directly into a pre-allocated byte buffer
 * - Integer millidegree value stored in a pre-allocated Int32Array ring buffer
 * - Trend computed from the ring buffer in-place (no copies)
 * - Backfill window tracked as a range [start, end) into the same ring buffer
 * - Float conversion (÷1000) only happens when data exits the system
 *
 * Zero allocations during operation. One syscall per poll.
 */
export class ThermalSensor {
	// Ring buffer for raw millidegree readings — stored exactly as parsed from sysfs
	private readonly temps: Uint32Array;
	private readonly timestamps: Float64Array;
	private head = 0;
	private count = 0;
	private readonly cap: number;

	// Backfill tracking — indices into the ring buffer
	private backfillStart = 0;
	private backfillEnd = 0;
	private _lockAcquiredAt = 0;

	// FFI state
	private readonly readBuf: Uint8Array;
	private ffiRead: (() => number) | null = null;
	private ffiClose: (() => void) | null = null;

	// Cached latest value for quick access
	private _latestMillideg = 0;
	private _hasReading = false;

	constructor(capacity: number = THERMAL_HISTORY_SIZE) {
		this.cap = capacity;
		this.temps = new Uint32Array(capacity);
		this.timestamps = new Float64Array(capacity);
		this.readBuf = new Uint8Array(16);
	}

	/** Initialize the FFI sensor for the given sysfs path. Call once at startup. */
	openSensor(path: string): void {
		const ffi = require("bun:ffi");
		const { dlopen, ptr } = ffi;
		const FFI = ffi.FFIType;

		const lib = dlopen("libc.so.6", {
			open: { args: [FFI.ptr, FFI.i32], returns: FFI.i32 },
			pread: { args: [FFI.i32, FFI.ptr, FFI.u64, FFI.i64], returns: FFI.i64 },
			close: { args: [FFI.i32], returns: FFI.i32 },
		});

		const pathBytes = new TextEncoder().encode(`${path}\0`);
		const fd = lib.symbols.open(ptr(pathBytes), 0 /* O_RDONLY */);
		if (fd < 0) throw new Error(`Failed to open thermal sensor: ${path}`);

		const bufPtr = ptr(this.readBuf);

		this.ffiRead = () => Number(lib.symbols.pread(fd, bufPtr, 16, 0));
		this.ffiClose = () => lib.symbols.close(fd);
	}

	/** Close the sensor fd. */
	closeSensor(): void {
		this.ffiClose?.();
		this.ffiRead = null;
		this.ffiClose = null;
	}

	/** Push a temperature reading directly (for testing without FFI). */
	push(tempC: number): void {
		const millideg = Math.round(tempC * 1000);
		this._latestMillideg = millideg;
		this._hasReading = true;
		this.temps[this.head] = millideg;
		this.timestamps[this.head] = Date.now();
		this.head = (this.head + 1) % this.cap;
		if (this.count < this.cap) this.count++;
	}

	/** Read sensor, store in ring buffer. Returns temp in °C or null. */
	poll(): number | null {
		if (!this.ffiRead) return null;

		const n = this.ffiRead();
		if (n <= 0) return null;

		// Parse millidegrees from ASCII in-place
		let val = 0;
		for (let i = 0; i < n; i++) {
			const c = this.readBuf[i];
			if (c < 0x30 || c > 0x39) break;
			val = val * 10 + (c - 0x30);
		}

		this._latestMillideg = val;
		this._hasReading = true;

		// Store in ring buffer
		this.temps[this.head] = val;
		this.timestamps[this.head] = Date.now();
		this.head = (this.head + 1) % this.cap;
		if (this.count < this.cap) this.count++;

		return val / 1000;
	}

	/** Current temperature in °C, or null if no readings. */
	get currentTemp(): number | null {
		return this._hasReading ? this._latestMillideg / 1000 : null;
	}

	/** Ring buffer count. */
	get size(): number {
		return this.count;
	}

	/** Returns readings oldest-first in °C. Allocates — call outside hot path. */
	toArray(): number[] {
		if (this.count === 0) return [];
		const result: number[] = new Array(this.count);
		const start = this.count < this.cap ? 0 : this.head;
		for (let i = 0; i < this.count; i++) {
			result[i] = this.temps[(start + i) % this.cap] / 1000;
		}
		return result;
	}

	/** Average of the last N readings in °C. */
	average(n: number): number | null {
		if (this.count === 0) return null;
		const take = Math.min(n, this.count);
		let sum = 0;
		for (let i = 0; i < take; i++) {
			const idx = (this.head - 1 - i + this.cap) % this.cap;
			sum += this.temps[idx];
		}
		return sum / take / 1000;
	}

	/** Determine trend from last N readings. */
	trend(n = 10, thresholdC = 0.5): "rising" | "falling" | "stable" {
		if (this.count < 2) return "stable";
		const take = Math.min(n, this.count);
		// Work in millidegrees to avoid float conversion
		const threshMd = thresholdC * 1000;

		let min = 0x7fffffff;
		let max = -0x7fffffff;
		for (let i = 0; i < take; i++) {
			const val = this.temps[(this.head - take + i + this.cap) % this.cap];
			if (val < min) min = val;
			if (val > max) max = val;
		}

		if (max - min > threshMd * 2) {
			const first = this.temps[(this.head - take + this.cap) % this.cap];
			const last = this.temps[(this.head - 1 + this.cap) % this.cap];
			return last > first ? "rising" : "falling";
		}

		const first = this.temps[(this.head - take + this.cap) % this.cap];
		const last = this.temps[(this.head - 1 + this.cap) % this.cap];
		const diff = last - first;
		if (diff > threshMd) return "rising";
		if (diff < -threshMd) return "falling";
		return "stable";
	}

	// --- Backfill ---

	/** Mark the start of a benchmark — begin tracking backfill range. */
	beginBackfill(): void {
		this.backfillStart = this.head;
		this.backfillEnd = this.head;
		this._lockAcquiredAt = Date.now();
	}

	/** Advance the backfill end pointer (call after each poll during lock). */
	recordBackfill(): void {
		this.backfillEnd = this.head;
	}

	/** Get backfill readings and lock window. Allocates — call after benchmark. */
	flushBackfill(): {
		readings: { temp: number; ts: number }[];
		lockAcquiredAt: number;
		lockReleasedAt: number;
	} | null {
		const start = this.backfillStart;
		const end = this.backfillEnd;
		if (start === end) return null;

		// Count entries from start to end in ring buffer
		const n = start <= end ? end - start : this.cap - start + end;
		const readings: { temp: number; ts: number }[] = new Array(n);
		for (let i = 0; i < n; i++) {
			const idx = (start + i) % this.cap;
			readings[i] = { temp: this.temps[idx] / 1000, ts: this.timestamps[idx] };
		}

		const result = {
			readings,
			lockAcquiredAt: this._lockAcquiredAt,
			lockReleasedAt: Date.now(),
		};

		this.backfillStart = this.backfillEnd;
		return result;
	}
}

/**
 * Find the CPU thermal zone on Linux.
 * Returns the sysfs path to the temp file, or null on non-Linux / missing sensor.
 */
export function findCpuThermalZone(): string | null {
	const base = "/sys/class/thermal";
	if (!existsSync(base)) return null;

	try {
		const zones = readdirSync(base).filter((d) => d.startsWith("thermal_zone"));
		for (const zone of zones) {
			const typePath = `${base}/${zone}/type`;
			if (existsSync(typePath)) {
				const type = readFileSync(typePath, "utf-8").trim();
				if (type.includes("x86_pkg") || type.includes("coretemp") || type.includes("cpu")) {
					return `${base}/${zone}/temp`;
				}
			}
		}
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
