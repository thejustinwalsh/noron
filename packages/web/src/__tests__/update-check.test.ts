import { describe, expect, test } from "bun:test";
import { compareSemver, parseReleaseTag } from "../update-check";

describe("compareSemver", () => {
	test("equal versions", () => {
		expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
		expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
	});

	test("major version difference", () => {
		expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
		expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
	});

	test("minor version difference", () => {
		expect(compareSemver("1.2.0", "1.1.0")).toBeGreaterThan(0);
		expect(compareSemver("1.1.0", "1.2.0")).toBeLessThan(0);
	});

	test("patch version difference", () => {
		expect(compareSemver("1.0.3", "1.0.2")).toBeGreaterThan(0);
		expect(compareSemver("1.0.2", "1.0.3")).toBeLessThan(0);
	});

	test("mixed version comparison", () => {
		expect(compareSemver("0.2.0", "0.1.5")).toBeGreaterThan(0);
		expect(compareSemver("1.0.0", "0.99.99")).toBeGreaterThan(0);
	});

	test("handles missing parts", () => {
		expect(compareSemver("1.0", "1.0.0")).toBe(0);
		expect(compareSemver("1", "1.0.0")).toBe(0);
	});
});

describe("parseReleaseTag", () => {
	test("parses standard tag", () => {
		expect(parseReleaseTag("@noron/iso@1.2.3")).toBe("1.2.3");
		expect(parseReleaseTag("@noron/iso@0.1.0")).toBe("0.1.0");
	});

	test("returns null for non-matching tags", () => {
		expect(parseReleaseTag("v1.2.3")).toBeNull();
		expect(parseReleaseTag("@noron/shared@1.0.0")).toBeNull();
		expect(parseReleaseTag("")).toBeNull();
	});

	test("handles pre-release tags", () => {
		expect(parseReleaseTag("@noron/iso@1.0.0-beta.1")).toBe("1.0.0-beta.1");
	});
});
