import { describe, expect, test } from "bun:test";
import { formatPerfStatSummary, parsePerfStat } from "../perf-stat";

// Sample output from `perf stat -d -x \t` on a real Linux system
const SAMPLE_OUTPUT = `# started on Mon Mar 22 10:00:00 2026

123456.78\tmsec\ttask-clock\t123456780000\t100.00
3\t\tcontext-switches\t123456780000\t100.00
0\t\tcpu-migrations\t123456780000\t100.00
1234\t\tpage-faults\t123456780000\t100.00
987654321\t\tcycles\t123456780000\t100.00
1975308642\t\tinstructions\t123456780000\t100.00
345678901\t\tbranches\t123456780000\t100.00
1234567\t\tbranch-misses\t123456780000\t100.00
567890123\t\tL1-dcache-loads\t123456780000\t100.00
12345678\t\tL1-dcache-load-misses\t123456780000\t100.00
`;

const NOISY_OUTPUT = `# started on Mon Mar 22 10:00:00 2026

50000.00\tmsec\ttask-clock\t50000000000\t100.00
42\t\tcontext-switches\t50000000000\t100.00
3\t\tcpu-migrations\t50000000000\t100.00
500\t\tpage-faults\t50000000000\t100.00
500000000\t\tcycles\t50000000000\t100.00
750000000\t\tinstructions\t50000000000\t100.00
100000000\t\tbranches\t50000000000\t100.00
5000000\t\tbranch-misses\t50000000000\t100.00
`;

describe("parsePerfStat", () => {
	test("parses all counters from sample output", () => {
		const result = parsePerfStat(SAMPLE_OUTPUT);

		expect(result.counters["task-clock"]).toEqual({
			value: 123456.78,
			unit: "msec",
			event: "task-clock",
		});
		expect(result.counters["context-switches"]?.value).toBe(3);
		expect(result.counters["cpu-migrations"]?.value).toBe(0);
		expect(result.counters["page-faults"]?.value).toBe(1234);
		expect(result.counters.cycles?.value).toBe(987654321);
		expect(result.counters.instructions?.value).toBe(1975308642);
		expect(result.counters.branches?.value).toBe(345678901);
		expect(result.counters["branch-misses"]?.value).toBe(1234567);
		expect(result.counters["L1-dcache-loads"]?.value).toBe(567890123);
		expect(result.counters["L1-dcache-load-misses"]?.value).toBe(12345678);
	});

	test("computes IPC correctly", () => {
		const result = parsePerfStat(SAMPLE_OUTPUT);
		// 1975308642 / 987654321 ≈ 2.0
		expect(result.ipc).toBeCloseTo(2.0, 1);
	});

	test("computes branch miss rate", () => {
		const result = parsePerfStat(SAMPLE_OUTPUT);
		// 1234567 / 345678901 * 100 ≈ 0.357%
		expect(result.branchMissRate).toBeCloseTo(0.357, 2);
	});

	test("computes L1 miss rate", () => {
		const result = parsePerfStat(SAMPLE_OUTPUT);
		// 12345678 / 567890123 * 100 ≈ 2.174%
		expect(result.l1MissRate).toBeCloseTo(2.174, 2);
	});

	test("marks isolation as healthy when context-switches <= 5 and cpu-migrations = 0", () => {
		const result = parsePerfStat(SAMPLE_OUTPUT);
		expect(result.contextSwitches).toBe(3);
		expect(result.cpuMigrations).toBe(0);
		expect(result.isolationHealthy).toBe(true);
	});

	test("marks isolation as unhealthy with high context switches", () => {
		const result = parsePerfStat(NOISY_OUTPUT);
		expect(result.contextSwitches).toBe(42);
		expect(result.cpuMigrations).toBe(3);
		expect(result.isolationHealthy).toBe(false);
	});

	test("handles empty input", () => {
		const result = parsePerfStat("");
		expect(Object.keys(result.counters)).toHaveLength(0);
		expect(result.ipc).toBeNull();
		expect(result.contextSwitches).toBe(0);
		expect(result.cpuMigrations).toBe(0);
		expect(result.isolationHealthy).toBe(true);
	});

	test("skips comment lines and malformed lines", () => {
		const input = `# comment line
not\tenough
123.45\tmsec\ttask-clock\t100\t100.00
garbage line with no tabs`;
		const result = parsePerfStat(input);
		expect(Object.keys(result.counters)).toHaveLength(1);
		expect(result.counters["task-clock"]?.value).toBe(123.45);
	});

	test("handles comma-formatted numbers", () => {
		const input = "1,234,567\t\tcycles\t100\t100.00";
		const result = parsePerfStat(input);
		expect(result.counters.cycles?.value).toBe(1234567);
	});
});

describe("formatPerfStatSummary", () => {
	test("formats healthy result", () => {
		const result = parsePerfStat(SAMPLE_OUTPUT);
		const summary = formatPerfStatSummary(result);
		expect(summary).toContain("HEALTHY");
		expect(summary).toContain("ctx-switches: 3");
		expect(summary).toContain("cpu-migrations: 0");
		expect(summary).toContain("IPC: 2.00");
	});

	test("formats unhealthy result with WARNING", () => {
		const result = parsePerfStat(NOISY_OUTPUT);
		const summary = formatPerfStatSummary(result);
		expect(summary).toContain("WARNING");
		expect(summary).toContain("ctx-switches: 42");
		expect(summary).toContain("cpu-migrations: 3");
	});
});
