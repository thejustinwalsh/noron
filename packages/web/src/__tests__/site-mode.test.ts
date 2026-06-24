import { describe, expect, test } from "bun:test";
import { isPublicSignupEnabled } from "../site-mode";

describe("isPublicSignupEnabled", () => {
	test("is disabled by default for appliance deployments", () => {
		expect(isPublicSignupEnabled({})).toBe(false);
	});

	test("enables the public signup site only when explicitly requested", () => {
		expect(isPublicSignupEnabled({ NORON_PUBLIC_SIGNUP: "1" })).toBe(true);
		expect(isPublicSignupEnabled({ NORON_PUBLIC_SIGNUP: "true" })).toBe(true);
		expect(isPublicSignupEnabled({ NORON_PUBLIC_SIGNUP: "0" })).toBe(false);
	});
});
