import { describe, expect, test } from "bun:test";
import { ThermalSensor, readThrottleCounts } from "../thermal";

describe("ThermalSensor", () => {
	test("starts empty", () => {
		const s = new ThermalSensor(10);
		expect(s.size).toBe(0);
		expect(s.currentTemp).toBeNull();
		expect(s.toArray()).toEqual([]);
		expect(s.average(5)).toBeNull();
	});

	test("push and read single value", () => {
		const s = new ThermalSensor(10);
		s.push(42.5);
		expect(s.size).toBe(1);
		expect(s.currentTemp).toBeCloseTo(42.5, 1);
		expect(s.toArray()[0]).toBeCloseTo(42.5, 1);
	});

	test("maintains order (oldest first)", () => {
		const s = new ThermalSensor(10);
		s.push(10);
		s.push(20);
		s.push(30);
		const arr = s.toArray();
		expect(arr[0]).toBeCloseTo(10, 1);
		expect(arr[1]).toBeCloseTo(20, 1);
		expect(arr[2]).toBeCloseTo(30, 1);
		expect(s.currentTemp).toBeCloseTo(30, 1);
	});

	test("wraps around at capacity", () => {
		const s = new ThermalSensor(3);
		s.push(10);
		s.push(20);
		s.push(30);
		s.push(40); // overwrites 10
		expect(s.size).toBe(3);
		const arr = s.toArray();
		expect(arr).toHaveLength(3);
		expect(arr[0]).toBeCloseTo(20, 1);
		expect(arr[1]).toBeCloseTo(30, 1);
		expect(arr[2]).toBeCloseTo(40, 1);
		expect(s.currentTemp).toBeCloseTo(40, 1);
	});

	test("average of last N", () => {
		const s = new ThermalSensor(10);
		s.push(10);
		s.push(20);
		s.push(30);
		expect(s.average(2)).toBeCloseTo(25, 1); // avg of 30, 20
		expect(s.average(3)).toBeCloseTo(20, 1); // avg of 30, 20, 10
		expect(s.average(100)).toBeCloseTo(20, 1); // clamped to count
	});

	test("trend detection", () => {
		const s = new ThermalSensor(10);
		// Stable: same values
		s.push(40);
		s.push(40);
		s.push(40);
		expect(s.trend()).toBe("stable");

		// Rising: >1°C increase
		const rising = new ThermalSensor(10);
		rising.push(40);
		rising.push(41);
		rising.push(42);
		expect(rising.trend()).toBe("rising");

		// Falling: >1°C decrease
		const falling = new ThermalSensor(10);
		falling.push(50);
		falling.push(49);
		falling.push(48);
		expect(falling.trend()).toBe("falling");
	});

	test("small oscillations are stable (SBC thermal noise)", () => {
		// Orange Pi 5 Plus idles at ~50°C with ±0.9°C sensor noise
		const s = new ThermalSensor(10);
		const readings = [50.8, 50.8, 49.9, 50.8, 50.8, 49.9, 50.8, 50.8, 49.9, 50.8];
		for (const r of readings) s.push(r);
		expect(s.trend()).toBe("stable");
	});

	test("wide oscillations are not stable", () => {
		// 3°C swings should be detected as unstable even if endpoints match
		const s = new ThermalSensor(10);
		const readings = [48, 51, 48, 51, 48, 51, 48, 51, 48, 51];
		for (const r of readings) s.push(r);
		expect(s.trend()).not.toBe("stable");
	});

	test("gradual drift within threshold is stable", () => {
		const s = new ThermalSensor(10);
		// 0.4°C total drift over 10 readings — within 0.5°C threshold
		const readings = [50.0, 50.0, 50.1, 50.1, 50.1, 50.2, 50.2, 50.3, 50.3, 50.4];
		for (const r of readings) s.push(r);
		expect(s.trend()).toBe("stable");
	});

	test("backfill tracking", () => {
		const s = new ThermalSensor(100);
		s.push(40);
		s.push(41);
		s.beginBackfill();
		s.push(42);
		s.recordBackfill();
		s.push(43);
		s.recordBackfill();
		s.push(44);
		s.recordBackfill();

		const backfill = s.flushBackfill();
		if (!backfill) throw new Error("expected backfill");
		expect(backfill.readings).toHaveLength(3);
		expect(backfill.readings[0].temp).toBeCloseTo(42, 1);
		expect(backfill.readings[2].temp).toBeCloseTo(44, 1);
		expect(backfill.lockAcquiredAt).toBeGreaterThan(0);
		expect(backfill.lockReleasedAt).toBeGreaterThanOrEqual(backfill.lockAcquiredAt);
	});

	test("backfill returns null when empty", () => {
		const s = new ThermalSensor(10);
		s.beginBackfill();
		expect(s.flushBackfill()).toBeNull();
	});
});

describe("readThrottleCounts", () => {
	test("returns null on macOS (no sysfs)", () => {
		const result = readThrottleCounts();
		// On macOS/CI, /sys/devices/system/cpu does not exist
		expect(result).toBeNull();
	});

	test("return type is Map or null", () => {
		const result = readThrottleCounts();
		expect(result === null || result instanceof Map).toBe(true);
	});
});
