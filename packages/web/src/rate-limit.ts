import type { Context, Next, MiddlewareHandler } from "hono";

interface RateLimiterOptions {
	/** Time window in milliseconds */
	windowMs: number;
	/** Maximum requests per window per IP */
	maxRequests: number;
}

interface Entry {
	count: number;
	resetAt: number;
}

/**
 * Simple in-memory rate limiter middleware for Hono.
 * Tracks requests per IP using a Map with periodic TTL cleanup.
 * Suitable for a single-appliance service (no shared state needed).
 */
export function createRateLimiter(opts: RateLimiterOptions): MiddlewareHandler {
	const map = new Map<string, Entry>();

	// Periodic cleanup of expired entries every 60 seconds
	const cleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of map) {
			if (now >= entry.resetAt) {
				map.delete(key);
			}
		}
	}, 60_000);

	// Allow the timer to not keep the process alive
	if (cleanupInterval.unref) {
		cleanupInterval.unref();
	}

	return async (c: Context, next: Next) => {
		const ip = getClientIp(c);
		const now = Date.now();
		let entry = map.get(ip);

		// Reset window if expired
		if (!entry || now >= entry.resetAt) {
			entry = { count: 0, resetAt: now + opts.windowMs };
			map.set(ip, entry);
		}

		entry.count++;

		// Set rate limit headers on every response
		const remaining = Math.max(0, opts.maxRequests - entry.count);
		c.header("X-RateLimit-Limit", String(opts.maxRequests));
		c.header("X-RateLimit-Remaining", String(remaining));
		c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

		if (entry.count > opts.maxRequests) {
			const retryAfterSecs = Math.ceil((entry.resetAt - now) / 1000);
			c.header("Retry-After", String(retryAfterSecs));
			return c.json({ error: "Too many requests" }, 429);
		}

		await next();
	};
}

/** Extract client IP from common proxy headers or Hono's built-in. */
function getClientIp(c: Context): string {
	return (
		c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
		c.req.header("x-real-ip") ||
		// Fallback — Hono doesn't expose remote address directly,
		// but Bun's server adds it. Use a generic fallback.
		"unknown"
	);
}
