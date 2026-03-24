import { describe, expect, test } from "bun:test";
import {
	type SetupConfig,
	generateBenchWebService,
	generateBenchdService,
	generateBenchmarkSlice,
	generateCpuGovernorService,
	generateDisableTurboService,
	generateGrubAppend,
	generateIrqPinScript,
	generateIrqPinService,
	generateSudoersConfig,
	generateSysctlConfig,
	generateTmpfsMount,
	recommendTmpfsSize,
} from "../generate";

const baseConfig: SetupConfig = {
	isolatedCores: [1, 2, 3],
	housekeepingCore: 0,
	githubClientId: "client-id",
	githubClientSecret: "client-secret",
	webPort: 9216,
	hostname: "bench-box",
	totalMemoryMB: 4096,
	runnerLabel: "noron",
};

describe("generateGrubAppend", () => {
	test("includes all kernel isolation params", () => {
		const result = generateGrubAppend(baseConfig);
		expect(result).toContain("isolcpus=1,2,3");
		expect(result).toContain("nohz_full=1,2,3");
		expect(result).toContain("rcu_nocbs=1,2,3");
		expect(result).toContain("nosmt");
	});

	test("single core config", () => {
		const cfg = { ...baseConfig, isolatedCores: [1] };
		const result = generateGrubAppend(cfg);
		expect(result).toContain("isolcpus=1");
		expect(result).not.toContain(",");
	});
});

describe("generateBenchmarkSlice", () => {
	test("sets AllowedCPUs to isolated cores", () => {
		const result = generateBenchmarkSlice(baseConfig);
		expect(result).toContain("AllowedCPUs=1,2,3");
		expect(result).toContain("AllowedMemoryNodes=0");
	});
});

describe("generateBenchdService", () => {
	test("pins to core 0 and has correct capabilities", () => {
		const result = generateBenchdService();
		expect(result).toContain("CPUAffinity=0");
		expect(result).toContain("CAP_SYS_NICE");
		expect(result).toContain("CAP_SYS_ADMIN");
		expect(result).toContain("ExecStart=/usr/local/bin/benchd");
	});
});

describe("generateBenchWebService", () => {
	test("bare hostname defaults to https without port", () => {
		const result = generateBenchWebService(baseConfig);
		expect(result).toContain("PORT=9216");
		expect(result).toContain("PUBLIC_URL=https://bench-box");
		expect(result).toContain("CPUAffinity=0");
		expect(result).toContain("User=bench");
	});

	test("explicit http:// URL gets port appended", () => {
		const cfg = { ...baseConfig, hostname: "http://localhost" };
		const result = generateBenchWebService(cfg);
		expect(result).toContain("PUBLIC_URL=http://localhost:9216");
	});

	test("explicit https:// URL used as-is without port", () => {
		const cfg = { ...baseConfig, hostname: "https://noron.tjw.dev" };
		const result = generateBenchWebService(cfg);
		expect(result).toContain("PUBLIC_URL=https://noron.tjw.dev");
	});

	test("custom housekeeping core", () => {
		const cfg = { ...baseConfig, housekeepingCore: 4 };
		const result = generateBenchWebService(cfg);
		expect(result).toContain("CPUAffinity=4");
	});
});

describe("generateSysctlConfig", () => {
	test("disables ASLR and watchdog per LLVM guidelines", () => {
		const result = generateSysctlConfig();
		expect(result).toContain("kernel.randomize_va_space = 0");
		expect(result).toContain("kernel.nmi_watchdog = 0");
		expect(result).toContain("vm.dirty_ratio = 5");
	});
});

describe("generateIrqPinScript", () => {
	test("pins IRQs to housekeeping core", () => {
		const result = generateIrqPinScript(baseConfig);
		expect(result).toContain("echo 0 > ");
		expect(result).toContain("smp_affinity_list");
	});
});

describe("generateSudoersConfig", () => {
	test("allows runner and bench users", () => {
		const result = generateSudoersConfig();
		expect(result).toContain("runner ALL=(root) NOPASSWD: SETENV: /usr/local/bin/bench-exec");
		expect(result).toContain("bench ALL=(root) NOPASSWD: /usr/local/bin/bench-updater");
		expect(result).not.toContain("runner-ctl");
	});
});

describe("generateIrqPinService", () => {
	test("is a oneshot service", () => {
		const result = generateIrqPinService(baseConfig);
		expect(result).toContain("Type=oneshot");
		expect(result).toContain("RemainAfterExit=yes");
	});
});

describe("generateDisableTurboService", () => {
	test("disables turbo and THP", () => {
		const result = generateDisableTurboService();
		expect(result).toContain("disable-turbo");
		expect(result).toContain("disable-thp");
	});
});

describe("recommendTmpfsSize", () => {
	test("returns null for low memory (<2GB)", () => {
		expect(recommendTmpfsSize(1024)).toBeNull();
		expect(recommendTmpfsSize(2047)).toBeNull();
	});

	test("returns 512m for 2-4GB", () => {
		expect(recommendTmpfsSize(2048)).toBe("512m");
		expect(recommendTmpfsSize(3072)).toBe("512m");
	});

	test("returns 2g for 4-8GB", () => {
		expect(recommendTmpfsSize(4096)).toBe("2g");
		expect(recommendTmpfsSize(7168)).toBe("2g");
	});

	test("returns 4g for 8GB+", () => {
		expect(recommendTmpfsSize(8192)).toBe("4g");
		expect(recommendTmpfsSize(16384)).toBe("4g");
	});
});

describe("generateTmpfsMount", () => {
	test("generates valid systemd mount unit", () => {
		const result = generateTmpfsMount("/mnt/bench-tmpfs", "2g");
		expect(result).toContain("What=tmpfs");
		expect(result).toContain("Where=/mnt/bench-tmpfs");
		expect(result).toContain("size=2g");
		expect(result).toContain("mode=1777");
	});
});

describe("generateCpuGovernorService", () => {
	test("sets performance governor", () => {
		const result = generateCpuGovernorService();
		expect(result).toContain("scaling_governor");
		expect(result).toContain("performance");
		expect(result).toContain("Type=oneshot");
	});
});

describe("generateSysctlConfig", () => {
	test("includes perf_event_paranoid for counters", () => {
		const result = generateSysctlConfig();
		expect(result).toContain("kernel.perf_event_paranoid = -1");
	});
});
