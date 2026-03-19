import { describe, expect, test } from "bun:test";
import { ThermalRingBuffer, readThrottleCounts } from "../thermal";

describe("ThermalRingBuffer", () => {
	test("starts empty", () => {
		const buf = new ThermalRingBuffer(10);
		expect(buf.size).toBe(0);
		expect(buf.latest()).toBeNull();
		expect(buf.toArray()).toEqual([]);
		expect(buf.average(5)).toBeNull();
	});

	test("push and read single value", () => {
		const buf = new ThermalRingBuffer(10);
		buf.push(42.5);
		expect(buf.size).toBe(1);
		expect(buf.latest()).toBe(42.5);
		expect(buf.toArray()).toEqual([42.5]);
	});

	test("maintains order (oldest first)", () => {
		const buf = new ThermalRingBuffer(10);
		buf.push(10);
		buf.push(20);
		buf.push(30);
		expect(buf.toArray()).toEqual([10, 20, 30]);
		expect(buf.latest()).toBe(30);
	});

	test("wraps around at capacity", () => {
		const buf = new ThermalRingBuffer(3);
		buf.push(10);
		buf.push(20);
		buf.push(30);
		buf.push(40); // overwrites 10
		expect(buf.size).toBe(3);
		expect(buf.toArray()).toEqual([20, 30, 40]);
		expect(buf.latest()).toBe(40);
	});

	test("average of last N", () => {
		const buf = new ThermalRingBuffer(10);
		buf.push(10);
		buf.push(20);
		buf.push(30);
		expect(buf.average(2)).toBe(25); // avg of 30, 20
		expect(buf.average(3)).toBe(20); // avg of 30, 20, 10
		expect(buf.average(100)).toBe(20); // clamped to count
	});

	test("trend detection", () => {
		const buf = new ThermalRingBuffer(10);
		// Stable: same values
		buf.push(40);
		buf.push(40);
		buf.push(40);
		expect(buf.trend()).toBe("stable");

		// Rising
		const rising = new ThermalRingBuffer(10);
		rising.push(40);
		rising.push(41);
		rising.push(42);
		expect(rising.trend()).toBe("rising");

		// Falling
		const falling = new ThermalRingBuffer(10);
		falling.push(50);
		falling.push(49);
		falling.push(48);
		expect(falling.trend()).toBe("falling");
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
