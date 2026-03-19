import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createRateLimiter } from "../rate-limit";

function buildApp(maxRequests: number, windowMs = 60_000) {
	const app = new Hono();
	app.use("/*", createRateLimiter({ windowMs, maxRequests }));
	app.get("/test", (c) => c.json({ ok: true }));
	app.post("/test", (c) => c.json({ ok: true }));
	return app;
}

function req(app: Hono, path = "/test", ip = "1.2.3.4") {
	return app.request(path, {
		headers: { "x-forwarded-for": ip },
	});
}

describe("createRateLimiter", () => {
	test("allows requests within the limit", async () => {
		const app = buildApp(3);
		for (let i = 0; i < 3; i++) {
			const res = await req(app);
			expect(res.status).toBe(200);
		}
	});

	test("returns 429 when limit is exceeded", async () => {
		const app = buildApp(2);
		await req(app); // 1
		await req(app); // 2
		const res = await req(app); // 3 — over limit
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toBe("Too many requests");
	});

	test("includes Retry-After header on 429", async () => {
		const app = buildApp(1);
		await req(app);
		const res = await req(app);
		expect(res.status).toBe(429);
		const retryAfter = res.headers.get("Retry-After");
		expect(retryAfter).toBeTruthy();
		expect(Number(retryAfter)).toBeGreaterThan(0);
	});

	test("includes X-RateLimit headers on every response", async () => {
		const app = buildApp(5);
		const res = await req(app);
		expect(res.status).toBe(200);
		expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
		expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
		expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
	});

	test("tracks different IPs separately", async () => {
		const app = buildApp(1);
		const res1 = await req(app, "/test", "10.0.0.1");
		const res2 = await req(app, "/test", "10.0.0.2");
		expect(res1.status).toBe(200);
		expect(res2.status).toBe(200);

		// Both should be blocked on second request
		const res3 = await req(app, "/test", "10.0.0.1");
		const res4 = await req(app, "/test", "10.0.0.2");
		expect(res3.status).toBe(429);
		expect(res4.status).toBe(429);
	});

	test("resets after window expires", async () => {
		const app = buildApp(1, 50); // 50ms window
		const res1 = await req(app);
		expect(res1.status).toBe(200);
		const res2 = await req(app);
		expect(res2.status).toBe(429);

		// Wait for window to expire
		await new Promise((r) => setTimeout(r, 60));
		const res3 = await req(app);
		expect(res3.status).toBe(200);
	});

	test("falls back to 'unknown' when no IP headers present", async () => {
		const app = buildApp(1);
		const res = await app.request("/test"); // no x-forwarded-for
		expect(res.status).toBe(200);
		const res2 = await app.request("/test");
		expect(res2.status).toBe(429);
	});
});
