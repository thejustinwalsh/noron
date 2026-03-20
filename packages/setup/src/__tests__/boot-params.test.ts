import { describe, expect, test } from "bun:test";
import { updateArmbianEnv, updateCmdline, updateGrubDefault } from "../generate";

const BENCH_PARAMS = "isolcpus=1,2,3 nohz_full=1,2,3 rcu_nocbs=1,2,3 nosmt";

describe("updateArmbianEnv", () => {
	test("adds extraargs when not present", () => {
		const input = `verbosity=1
bootlogo=false
overlay_prefix=sun50i-h616`;
		const result = updateArmbianEnv(input, BENCH_PARAMS);
		expect(result).toContain(`extraargs=${BENCH_PARAMS}`);
		expect(result).toContain("verbosity=1");
		expect(result.endsWith("\n")).toBe(true);
	});

	test("appends to existing extraargs", () => {
		const input = `verbosity=1
extraargs=cma=256M
overlay_prefix=rk3588`;
		const result = updateArmbianEnv(input, BENCH_PARAMS);
		expect(result).toContain(`extraargs=cma=256M ${BENCH_PARAMS}`);
		expect(result).toContain("verbosity=1");
		expect(result).toContain("overlay_prefix=rk3588");
	});

	test("replaces previous bench params in existing extraargs", () => {
		const input = `verbosity=1
extraargs=cma=256M isolcpus=0,1 nohz_full=0,1 rcu_nocbs=0,1 nosmt
overlay_prefix=rk3588`;
		const result = updateArmbianEnv(input, BENCH_PARAMS);
		expect(result).toContain(`extraargs=cma=256M ${BENCH_PARAMS}`);
		// Should not have duplicate params
		expect(result.match(/isolcpus=/g)?.length).toBe(1);
		expect(result.match(/nosmt/g)?.length).toBe(1);
	});

	test("handles extraargs with only bench params", () => {
		const input = `verbosity=1
extraargs=isolcpus=0,1 nosmt`;
		const result = updateArmbianEnv(input, BENCH_PARAMS);
		expect(result).toContain(`extraargs=${BENCH_PARAMS}`);
		// No double spaces or leading space after =
		expect(result).not.toContain("extraargs= ");
	});

	test("handles empty extraargs", () => {
		const input = `verbosity=1
extraargs=
overlay_prefix=rk3588`;
		const result = updateArmbianEnv(input, BENCH_PARAMS);
		expect(result).toContain(`extraargs=${BENCH_PARAMS}`);
	});

	test("preserves trailing newline", () => {
		const input = "verbosity=1\n";
		const result = updateArmbianEnv(input, BENCH_PARAMS);
		expect(result.endsWith("\n")).toBe(true);
	});
});

describe("updateCmdline", () => {
	test("appends params to existing cmdline", () => {
		const input =
			"console=serial0,115200 console=tty1 root=PARTUUID=abc rootfstype=ext4 fsck.repair=yes rootwait";
		const result = updateCmdline(input, BENCH_PARAMS);
		expect(result).toContain("console=serial0,115200");
		expect(result).toContain("rootwait");
		expect(result).toEndWith(BENCH_PARAMS);
	});

	test("replaces previous bench params", () => {
		const input = "console=tty1 root=/dev/sda1 isolcpus=0 nohz_full=0 rcu_nocbs=0 nosmt rootwait";
		const result = updateCmdline(input, BENCH_PARAMS);
		expect(result.match(/isolcpus=/g)?.length).toBe(1);
		expect(result).toContain("console=tty1");
		expect(result).toContain("rootwait");
		expect(result).toEndWith(BENCH_PARAMS);
	});

	test("handles cmdline with no previous bench params", () => {
		const input = "root=/dev/sda1 quiet";
		const result = updateCmdline(input, BENCH_PARAMS);
		expect(result).toBe(`root=/dev/sda1 quiet ${BENCH_PARAMS}`);
	});
});

describe("updateGrubDefault", () => {
	test("updates GRUB_CMDLINE_LINUX_DEFAULT", () => {
		const input = `GRUB_DEFAULT=0
GRUB_TIMEOUT=5
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
GRUB_CMDLINE_LINUX=""`;
		const result = updateGrubDefault(input, BENCH_PARAMS);
		expect(result).toContain(`GRUB_CMDLINE_LINUX_DEFAULT="quiet ${BENCH_PARAMS}"`);
		expect(result).toContain("GRUB_DEFAULT=0");
		expect(result).toContain('GRUB_CMDLINE_LINUX=""');
	});

	test("preserves other grub settings", () => {
		const input = `GRUB_DEFAULT=0
GRUB_TIMEOUT=5
GRUB_CMDLINE_LINUX_DEFAULT="quiet"
GRUB_CMDLINE_LINUX="console=ttyS0"
GRUB_TERMINAL=serial`;
		const result = updateGrubDefault(input, BENCH_PARAMS);
		expect(result).toContain('GRUB_CMDLINE_LINUX="console=ttyS0"');
		expect(result).toContain("GRUB_TERMINAL=serial");
	});

	test("replaces existing bench params in grub", () => {
		const input = `GRUB_CMDLINE_LINUX_DEFAULT="quiet isolcpus=0 nosmt"`;
		const result = updateGrubDefault(input, BENCH_PARAMS);
		expect(result).toContain(`GRUB_CMDLINE_LINUX_DEFAULT="quiet ${BENCH_PARAMS}"`);
	});
});
