import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { VIOLATION_STRIKE_LIMIT, VIOLATION_WINDOW_MS } from "@noron/shared";
import { extractToken, getUserByToken } from "../auth-middleware";

/**
 * Record a violation in the database and check strike limits.
 * Used by the IPC violation handler (bench-web subscribes to benchd events).
 */
export function recordViolation(
	db: Database,
	repo: string,
	jobId: string | null,
	runId: string | null,
	reason: string,
): { recorded: boolean; strikeCount: number; disabled: boolean } {
	const id = crypto.randomUUID();
	const now = Date.now();

	db.run(
		"INSERT INTO violations (id, repo, job_id, run_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		[id, repo, jobId, runId, reason, now],
	);

	// Link to runner if one exists for this repo
	const runner = db.query("SELECT id FROM runners WHERE repo = ?").get(repo) as { id: string } | null;
	if (runner) {
		db.run("UPDATE violations SET runner_id = ? WHERE id = ?", [runner.id, id]);
	}

	// Count recent violations for this repo
	const windowStart = now - VIOLATION_WINDOW_MS;
	const count = db.query(
		"SELECT COUNT(*) as count FROM violations WHERE repo = ? AND created_at > ?",
	).get(repo, windowStart) as { count: number };

	const result = { recorded: true, strikeCount: count.count, disabled: false };

	// Disable runner after strike limit
	if (count.count >= VIOLATION_STRIKE_LIMIT && runner) {
		db.run(
			"UPDATE runners SET status = 'disabled', disabled_at = ?, disabled_reason = ? WHERE id = ? AND (status != 'disabled' OR disabled_at IS NULL)",
			[now, `${VIOLATION_STRIKE_LIMIT} violations in ${VIOLATION_WINDOW_MS / 86400000} days`, runner.id],
		);
		result.disabled = true;
		console.warn(`[violations] Runner for ${repo} disabled after ${count.count} violations`);
	}

	return result;
}

/**
 * Violation tracking routes (all admin-only).
 *
 * GET /api/violations — admin: list violations
 * POST /api/violations/reset — admin: reset strikes for a repo
 * PUT /api/runners/:id/timeout — admin: set per-repo timeout override
 */
export function violationRoutes(db: Database) {
	const app = new Hono();

	// List violations (admin only)
	app.get("/violations", (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);
		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

		const repo = c.req.query("repo");
		if (repo) {
			const violations = db.query(
				"SELECT * FROM violations WHERE repo = ? ORDER BY created_at DESC LIMIT 100",
			).all(repo);
			return c.json({ violations });
		}
		const violations = db.query(
			"SELECT * FROM violations ORDER BY created_at DESC LIMIT 100",
		).all();
		return c.json({ violations });
	});

	// Reset strikes for a repo (admin only)
	app.post("/violations/reset", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);
		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

		const body = await c.req.json<{ repo: string }>();
		if (!body.repo) return c.json({ error: "repo is required" }, 400);

		db.run("DELETE FROM violations WHERE repo = ?", [body.repo]);

		// Re-enable the runner if it was disabled
		const runner = db.query("SELECT id FROM runners WHERE repo = ?").get(body.repo) as { id: string } | null;
		if (runner) {
			db.run(
				"UPDATE runners SET status = 'offline', disabled_at = NULL, disabled_reason = NULL WHERE id = ?",
				[runner.id],
			);
		}

		return c.json({ reset: true, repo: body.repo });
	});

	// Set per-repo timeout override (admin only)
	app.put("/runners/:id/timeout", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);
		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

		const runnerId = c.req.param("id");
		const body = await c.req.json<{ jobTimeoutMs: number | null }>();

		// Validate: null clears override (uses global default), number sets it
		const timeoutMs = body.jobTimeoutMs;
		if (timeoutMs !== null && (typeof timeoutMs !== "number" || timeoutMs < 60_000 || timeoutMs > 86_400_000)) {
			return c.json({ error: "jobTimeoutMs must be between 60000 (1 min) and 86400000 (24 hours), or null to use default" }, 400);
		}

		const runner = db.query("SELECT id FROM runners WHERE id = ?").get(runnerId) as { id: string } | null;
		if (!runner) return c.json({ error: "Runner not found" }, 404);

		db.run("UPDATE runners SET job_timeout_ms = ? WHERE id = ?", [timeoutMs, runnerId]);

		return c.json({ ok: true, jobTimeoutMs: timeoutMs });
	});

	return app;
}
