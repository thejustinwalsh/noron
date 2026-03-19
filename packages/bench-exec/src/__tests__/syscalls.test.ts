import { describe, expect, test } from "bun:test";
import { applyIonice, applyNice } from "../syscalls";

describe("syscalls validation", () => {
	test("applyNice rejects priority below -20", () => {
		expect(() => applyNice(-21)).toThrow("between -20 and 19");
	});

	test("applyNice rejects priority above 19", () => {
		expect(() => applyNice(20)).toThrow("between -20 and 19");
	});

	test("applyNice accepts boundary values", () => {
		// These will fail on macOS without root, but validation passes
		try {
			applyNice(-20);
		} catch (e) {
			// Expected on macOS — renice may fail, but arg validation passed
			expect(String(e)).toContain("Failed to set nice");
		}
	});

	test("applyIonice rejects classId below 0", () => {
		expect(() => applyIonice(-1)).toThrow("between 0 and 3");
	});

	test("applyIonice rejects classId above 3", () => {
		expect(() => applyIonice(4)).toThrow("between 0 and 3");
	});

	test("applyCpuAffinity rejects empty cores", async () => {
		const { applyCpuAffinity } = await import("../syscalls");
		expect(() => applyCpuAffinity([])).toThrow("at least one core");
	});

	test("dropPrivileges requires SUDO_UID and SUDO_GID", async () => {
		const { dropPrivileges } = await import("../syscalls");
		const origUid = process.env.SUDO_UID;
		const origGid = process.env.SUDO_GID;
		process.env.SUDO_UID = undefined;
		process.env.SUDO_GID = undefined;
		try {
			expect(() => dropPrivileges()).toThrow("SUDO_UID and SUDO_GID must be set");
		} finally {
			if (origUid) process.env.SUDO_UID = origUid;
			if (origGid) process.env.SUDO_GID = origGid;
		}
	});

	test("dropPrivileges rejects invalid SUDO_UID", async () => {
		const { dropPrivileges } = await import("../syscalls");
		const origUid = process.env.SUDO_UID;
		const origGid = process.env.SUDO_GID;
		process.env.SUDO_UID = "notanumber";
		process.env.SUDO_GID = "1000";
		try {
			expect(() => dropPrivileges()).toThrow("invalid SUDO_UID");
		} finally {
			if (origUid) process.env.SUDO_UID = origUid;
			else process.env.SUDO_UID = undefined;
			if (origGid) process.env.SUDO_GID = origGid;
			else process.env.SUDO_GID = undefined;
		}
	});

	test("dropPrivileges rejects negative SUDO_GID", async () => {
		const { dropPrivileges } = await import("../syscalls");
		const origUid = process.env.SUDO_UID;
		const origGid = process.env.SUDO_GID;
		process.env.SUDO_UID = "1000";
		process.env.SUDO_GID = "-5";
		try {
			expect(() => dropPrivileges()).toThrow("invalid SUDO_GID");
		} finally {
			if (origUid) process.env.SUDO_UID = origUid;
			else process.env.SUDO_UID = undefined;
			if (origGid) process.env.SUDO_GID = origGid;
			else process.env.SUDO_GID = undefined;
		}
	});
});
