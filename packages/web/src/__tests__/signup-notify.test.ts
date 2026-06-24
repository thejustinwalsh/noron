import { afterEach, describe, expect, test } from "bun:test";
import {
	type SignupApplication,
	createSignupNotifierFromEnv,
	renderSignupEmail,
} from "../signup-notify";

const application: SignupApplication = {
	email: "founder@example.com",
	name: "Founder",
	company: "Example Co",
	projectType: "commercial",
	githubUrl: "https://github.com/example/project",
	useCase: "We want stable benchmark notifications.",
	ip: "203.0.113.10",
	userAgent: "bun-test",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("signup notifications", () => {
	test("returns a no-op notifier when Cloudflare email env is incomplete", async () => {
		const notifier = createSignupNotifierFromEnv({
			CLOUDFLARE_ACCOUNT_ID: "account-id",
			SIGNUP_NOTIFY_FROM: "Noron <signup@example.com>",
			SIGNUP_NOTIFY_TO: "founder@example.com",
		});

		await expect(notifier(application)).resolves.toBeUndefined();
	});

	test("sends signup notifications through Cloudflare Email Sending", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}) as typeof fetch;

		const notifier = createSignupNotifierFromEnv({
			CLOUDFLARE_ACCOUNT_ID: "account-id",
			CLOUDFLARE_API_TOKEN: "token",
			SIGNUP_NOTIFY_FROM: "Noron <signup@example.com>",
			SIGNUP_NOTIFY_TO: "founder@example.com",
		});

		await notifier(application);

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/send",
		);
		expect(calls[0].init.method).toBe("POST");
		expect(calls[0].init.headers).toMatchObject({
			authorization: "Bearer token",
			"content-type": "application/json",
		});
		expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
			from: "Noron <signup@example.com>",
			to: "founder@example.com",
			subject: "Noron signup: Example Co",
		});
	});

	test("renders useful plain text lead details", () => {
		const text = renderSignupEmail(application);

		expect(text).toContain("New Noron signup request");
		expect(text).toContain("Email: founder@example.com");
		expect(text).toContain("Company/project: Example Co");
		expect(text).toContain("Use type: commercial");
		expect(text).toContain("We want stable benchmark notifications.");
	});
});
