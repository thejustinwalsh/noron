import { describe, expect, test } from "bun:test";
import { detectCpuTopology, parseCpuRange } from "../cpu-topology";

describe("parseCpuRange", () => {
	test("parses single core", () => {
		expect(parseCpuRange("0")).toEqual([0]);
	});

	test("parses simple range", () => {
		expect(parseCpuRange("0-3")).toEqual([0, 1, 2, 3]);
	});

	test("parses comma-separated values", () => {
		expect(parseCpuRange("0,2,4")).toEqual([0, 2, 4]);
	});

	test("parses mixed ranges and values", () => {
		expect(parseCpuRange("0-1,4-7")).toEqual([0, 1, 4, 5, 6, 7]);
	});

	test("parses complex CPU online string", () => {
		expect(parseCpuRange("0-3,8-11")).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
	});

	test("handles whitespace", () => {
		expect(parseCpuRange(" 0 - 3 , 5 ")).toEqual([0, 1, 2, 3, 5]);
	});

	test("returns sorted results", () => {
		expect(parseCpuRange("4,1,2")).toEqual([1, 2, 4]);
	});

	test("handles large core count (16 cores)", () => {
		const result = parseCpuRange("0-15");
		expect(result).toHaveLength(16);
		expect(result[0]).toBe(0);
		expect(result[15]).toBe(15);
	});
});

describe("core allocation strategy", () => {
	// Test the strategy: core 0 = housekeeping, rest = isolated
	function recommendCores(onlineCores: number[]) {
		const housekeeping = onlineCores[0] ?? 0;
		const isolated = onlineCores.filter((c) => c !== housekeeping);
		return { housekeeping, isolated };
	}

	test("1 core: no isolation possible", () => {
		const { housekeeping, isolated } = recommendCores([0]);
		expect(housekeeping).toBe(0);
		expect(isolated).toEqual([]);
	});

	test("2 cores: 1 isolated", () => {
		const { housekeeping, isolated } = recommendCores([0, 1]);
		expect(housekeeping).toBe(0);
		expect(isolated).toEqual([1]);
	});

	test("4 cores: 3 isolated (original Chromebox config)", () => {
		const { housekeeping, isolated } = recommendCores([0, 1, 2, 3]);
		expect(housekeeping).toBe(0);
		expect(isolated).toEqual([1, 2, 3]);
	});

	test("8 cores: 7 isolated", () => {
		const { housekeeping, isolated } = recommendCores([0, 1, 2, 3, 4, 5, 6, 7]);
		expect(housekeeping).toBe(0);
		expect(isolated).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	test("16 cores: 15 isolated", () => {
		const cores = Array.from({ length: 16 }, (_, i) => i);
		const { housekeeping, isolated } = recommendCores(cores);
		expect(housekeeping).toBe(0);
		expect(isolated).toHaveLength(15);
		expect(isolated[0]).toBe(1);
		expect(isolated[14]).toBe(15);
	});

	test("non-contiguous cores (e.g., NUMA gaps)", () => {
		const { housekeeping, isolated } = recommendCores([0, 2, 4, 6]);
		expect(housekeeping).toBe(0);
		expect(isolated).toEqual([2, 4, 6]);
	});
});

describe("detectCpuTopology", () => {
	test("returns null coreCapacities when sysfs is unavailable", () => {
		const topology = detectCpuTopology();
		// On macOS/CI, cpu_capacity sysfs files won't exist
		expect(topology.coreCapacities).toBeNull();
	});

	test("falls back to core 0 housekeeping when capacities unavailable", () => {
		const topology = detectCpuTopology();
		expect(topology.coreCapacities).toBeNull();
		expect(topology.recommendedHousekeeping).toBe(topology.onlineCores[0] ?? 0);
		expect(topology.recommendedIsolated).toEqual(
			topology.onlineCores.filter((c) => c !== topology.recommendedHousekeeping),
		);
	});

	test("topology interface includes coreCapacities field", () => {
		const topology = detectCpuTopology();
		expect("coreCapacities" in topology).toBe(true);
	});
});

describe("big.LITTLE capacity grouping logic", () => {
	// Mirrors the grouping logic from detectCpuTopology when coreCapacities is present.
	// Since we can't mock sysfs, we test the pure algorithm extracted here.
	function groupByCapacity(
		onlineCores: number[],
		capacities: Map<number, number>,
	): { housekeeping: number; isolated: number[] } {
		const capacityValues = [...capacities.values()];
		const maxCap = Math.max(...capacityValues);
		const minCap = Math.min(...capacityValues);

		const housekeeping =
			onlineCores.find((c) => capacities.get(c) === minCap) ?? onlineCores[0] ?? 0;
		const isolated = onlineCores.filter(
			(c) => capacities.get(c) === maxCap && c !== housekeeping,
		);
		return { housekeeping, isolated };
	}

	test("selects efficiency core for housekeeping, performance cores for isolation", () => {
		// Simulates a 4+4 big.LITTLE: cores 0-3 are LITTLE (512), cores 4-7 are big (1024)
		const cores = [0, 1, 2, 3, 4, 5, 6, 7];
		const caps = new Map([
			[0, 512], [1, 512], [2, 512], [3, 512],
			[4, 1024], [5, 1024], [6, 1024], [7, 1024],
		]);
		const { housekeeping, isolated } = groupByCapacity(cores, caps);
		expect(housekeeping).toBe(0); // first LITTLE core
		expect(isolated).toEqual([4, 5, 6, 7]); // all big cores
	});

	test("homogeneous capacities: housekeeping is first core, all others isolated", () => {
		const cores = [0, 1, 2, 3];
		const caps = new Map([[0, 1024], [1, 1024], [2, 1024], [3, 1024]]);
		const { housekeeping, isolated } = groupByCapacity(cores, caps);
		// When min === max, housekeeping = first core with minCap = core 0
		// isolated = cores where cap === maxCap AND c !== housekeeping = [1, 2, 3]
		expect(housekeeping).toBe(0);
		expect(isolated).toEqual([1, 2, 3]);
	});

	test("2+6 mixed layout: one efficiency core, six performance cores", () => {
		const cores = [0, 1, 2, 3, 4, 5, 6, 7];
		const caps = new Map([
			[0, 256], [1, 256],
			[2, 1024], [3, 1024], [4, 1024], [5, 1024], [6, 1024], [7, 1024],
		]);
		const { housekeeping, isolated } = groupByCapacity(cores, caps);
		expect(housekeeping).toBe(0); // first efficiency core
		expect(isolated).toEqual([2, 3, 4, 5, 6, 7]); // all performance cores
	});

	test("three-tier capacities: housekeeping = lowest, isolated = highest only", () => {
		// Simulates a tri-cluster SoC: 2 LITTLE (256), 3 medium (680), 1 big (1024)
		const cores = [0, 1, 2, 3, 4, 5];
		const caps = new Map([
			[0, 256], [1, 256],
			[2, 680], [3, 680], [4, 680],
			[5, 1024],
		]);
		const { housekeeping, isolated } = groupByCapacity(cores, caps);
		expect(housekeeping).toBe(0); // first LITTLE core
		expect(isolated).toEqual([5]); // only the big core
	});
});
