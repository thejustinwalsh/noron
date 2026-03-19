import { describe, expect, test } from "bun:test";
import {
	parseToml,
	serializeToml,
	DEFAULT_CONFIG,
	type BenchdConfig,
} from "../config";

describe("TOML parsing", () => {
	test("parses integer values", () => {
		const result = parseToml("target_temp_c = 45");
		expect(result.target_temp_c).toBe(45);
	});

	test("parses string values", () => {
		const result = parseToml('socket_path = "/var/run/benchd.sock"');
		expect(result.socket_path).toBe("/var/run/benchd.sock");
	});

	test("parses integer arrays", () => {
		const result = parseToml("isolated_cores = [1, 2, 3]");
		expect(result.isolated_cores).toEqual([1, 2, 3]);
	});

	test("parses empty arrays", () => {
		const result = parseToml("isolated_cores = []");
		expect(result.isolated_cores).toEqual([]);
	});

	test("parses boolean values", () => {
		const result = parseToml("enabled = true\ndisabled = false");
		expect(result.enabled).toBe(true);
		expect(result.disabled).toBe(false);
	});

	test("ignores comments and blank lines", () => {
		const result = parseToml("# comment\n\nkey = 42\n# another comment");
		expect(result.key).toBe(42);
		expect(Object.keys(result)).toHaveLength(1);
	});

	test("handles inline equals in values gracefully", () => {
		const result = parseToml('path = "/some/path"');
		expect(result.path).toBe("/some/path");
	});
});

describe("TOML serialization", () => {
	test("round-trips default config", () => {
		const toml = serializeToml(DEFAULT_CONFIG);
		const parsed = parseToml(toml);

		expect(parsed.isolated_cores).toEqual(DEFAULT_CONFIG.isolatedCores);
		expect(parsed.housekeeping_core).toBe(DEFAULT_CONFIG.housekeepingCore);
		expect(parsed.target_temp_c).toBe(DEFAULT_CONFIG.targetTempC);
		expect(parsed.thermal_history_size).toBe(DEFAULT_CONFIG.thermalHistorySize);
		expect(parsed.thermal_poll_interval_ms).toBe(DEFAULT_CONFIG.thermalPollIntervalMs);
		expect(parsed.thermal_timeout_ms).toBe(DEFAULT_CONFIG.thermalTimeoutMs);
		expect(parsed.socket_path).toBe(DEFAULT_CONFIG.socketPath);
		expect(parsed.benchmark_slice).toBe(DEFAULT_CONFIG.benchmarkSlice);
		expect(parsed.benchmark_cgroup).toBe(DEFAULT_CONFIG.benchmarkCgroup);
		expect(parsed.bench_tmpfs).toBe(DEFAULT_CONFIG.benchTmpfs);
		expect(parsed.lock_disconnect_grace_ms).toBe(DEFAULT_CONFIG.lockDisconnectGraceMs);
		expect(parsed.token_expiry_hours).toBe(DEFAULT_CONFIG.tokenExpiryHours);
	});

	test("round-trips custom config", () => {
		const config: BenchdConfig = {
			...DEFAULT_CONFIG,
			isolatedCores: [4, 5, 6, 7],
			housekeepingCore: 0,
			targetTempC: 50,
		};
		const toml = serializeToml(config);
		const parsed = parseToml(toml);

		expect(parsed.isolated_cores).toEqual([4, 5, 6, 7]);
		expect(parsed.housekeeping_core).toBe(0);
		expect(parsed.target_temp_c).toBe(50);
	});

	test("produces human-readable output with comments", () => {
		const toml = serializeToml(DEFAULT_CONFIG);
		expect(toml).toContain("# benchd configuration");
		expect(toml).toContain("# CPU core allocation");
		expect(toml).toContain("# Thermal settings");
	});
});

describe("DEFAULT_CONFIG new fields", () => {
	test("runnerLabel defaults to 'noron'", () => {
		expect(DEFAULT_CONFIG.runnerLabel).toBe("noron");
	});

	test("thermalMarginC defaults to 3", () => {
		expect(DEFAULT_CONFIG.thermalMarginC).toBe(3);
	});

	test("thermalBaselineSettlingS defaults to 30", () => {
		expect(DEFAULT_CONFIG.thermalBaselineSettlingS).toBe(30);
	});
});

describe("TOML serialization of new fields", () => {
	test("serialization includes runner_label", () => {
		const toml = serializeToml(DEFAULT_CONFIG);
		expect(toml).toContain('runner_label = "noron"');
	});

	test("serialization includes thermal_margin_c", () => {
		const toml = serializeToml(DEFAULT_CONFIG);
		expect(toml).toContain("thermal_margin_c = 3");
	});

	test("serialization includes thermal_baseline_settling_s", () => {
		const toml = serializeToml(DEFAULT_CONFIG);
		expect(toml).toContain("thermal_baseline_settling_s = 30");
	});

	test("round-trip preserves runner_label", () => {
		const config: BenchdConfig = { ...DEFAULT_CONFIG, runnerLabel: "custom-runner" };
		const toml = serializeToml(config);
		const parsed = parseToml(toml);
		expect(parsed.runner_label).toBe("custom-runner");
	});

	test("round-trip preserves thermal_margin_c", () => {
		const config: BenchdConfig = { ...DEFAULT_CONFIG, thermalMarginC: 5 };
		const toml = serializeToml(config);
		const parsed = parseToml(toml);
		expect(parsed.thermal_margin_c).toBe(5);
	});

	test("round-trip preserves thermal_baseline_settling_s", () => {
		const config: BenchdConfig = { ...DEFAULT_CONFIG, thermalBaselineSettlingS: 60 };
		const toml = serializeToml(config);
		const parsed = parseToml(toml);
		expect(parsed.thermal_baseline_settling_s).toBe(60);
	});

	test("full round-trip: serialize then parse preserves all new fields", () => {
		const config: BenchdConfig = {
			...DEFAULT_CONFIG,
			runnerLabel: "my-bench",
			thermalMarginC: 7,
			thermalBaselineSettlingS: 45,
		};
		const toml = serializeToml(config);
		const parsed = parseToml(toml);

		expect(parsed.runner_label).toBe("my-bench");
		expect(parsed.thermal_margin_c).toBe(7);
		expect(parsed.thermal_baseline_settling_s).toBe(45);
	});
});
