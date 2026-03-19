import { describe, expect, test } from "bun:test";
import { detectHardware } from "../detect";

describe("detectHardware", () => {
	test("returns a complete hardware profile", () => {
		const hw = detectHardware();
		expect(hw.cpu.totalCores).toBeGreaterThan(0);
		expect(hw.cpu.onlineCores.length).toBeGreaterThan(0);
		expect(hw.memory.totalMB).toBeGreaterThan(0);
		expect(typeof hw.hostname).toBe("string");
		expect(["sbc", "desktop", "server", "vm", "unknown"]).toContain(hw.platform);
		expect(Array.isArray(hw.network)).toBe(true);
	});

	test("cpu topology recommends core split", () => {
		const hw = detectHardware();
		if (hw.cpu.totalCores > 1) {
			expect(hw.cpu.recommendedHousekeeping).toBe(0);
			expect(hw.cpu.recommendedIsolated.length).toBeGreaterThan(0);
			expect(hw.cpu.recommendedIsolated).not.toContain(0);
		}
	});
});
