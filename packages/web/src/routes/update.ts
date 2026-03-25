import type { Database } from "bun:sqlite";
import type { BenchdConfig } from "@noron/shared";
import { Hono } from "hono";
import { extractToken, getUserByToken } from "../auth-middleware";
import { logAudit } from "../db";
import { checkForUpdate } from "../update-check";
import { NORON_VERSION } from "../version";

interface UpdateRow {
	id: string;
	version: string;
	state: string;
	download_url: string | null;
	started_at: number | null;
	completed_at: number | null;
	error: string | null;
}

export function updateRoutes(db: Database, config: BenchdConfig) {
	const app = new Hono();

	// Auth middleware for all update routes
	app.use("/update/*", async (c, next) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);
		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		await next();
	});

	// GET /update/status — current update state
	app.get("/update/status", (c) => {
		const latest = db
			.query("SELECT * FROM updates ORDER BY started_at DESC LIMIT 1")
			.get() as UpdateRow | null;

		return c.json({
			currentVersion: NORON_VERSION,
			updateRepo: config.updateRepo || null,
			autoUpdate: config.updateAuto,
			latest: latest
				? {
						id: latest.id,
						version: latest.version,
						state: latest.state,
						startedAt: latest.started_at,
						completedAt: latest.completed_at,
						error: latest.error,
					}
				: null,
		});
	});

	// POST /update/check — trigger an immediate update check
	app.post("/update/check", async (c) => {
		if (!config.updateRepo) {
			return c.json({ error: "update_repo not configured" }, 400);
		}

		await checkForUpdate(db, config);

		const latest = db
			.query("SELECT * FROM updates ORDER BY started_at DESC LIMIT 1")
			.get() as UpdateRow | null;

		return c.json({
			checked: true,
			currentVersion: NORON_VERSION,
			latest: latest ? { version: latest.version, state: latest.state } : null,
		});
	});

	// POST /update/apply — trigger update now (if one is available)
	app.post("/update/apply", async (c) => {
		if (!config.updateRepo) {
			return c.json({ error: "update_repo not configured" }, 400);
		}

		// Check for update first, then it will auto-start the workflow
		await checkForUpdate(db, config);

		const latest = db
			.query("SELECT * FROM updates ORDER BY started_at DESC LIMIT 1")
			.get() as UpdateRow | null;

		if (!latest || latest.state === "completed") {
			return c.json({ message: "Already up to date", currentVersion: NORON_VERSION });
		}

		return c.json({
			message: "Update started",
			version: latest.version,
			state: latest.state,
		});
	});

	// POST /update/rollback — manually rollback to previous version (admin only)
	app.post("/update/rollback", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);
		const user = getUserByToken(db, token);
		if (!user || user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

		// Check if a rollback backup exists
		const { existsSync } = await import("node:fs");
		const { readdirSync } = await import("node:fs");
		const updatesDir = "/var/lib/bench/updates";
		let hasBackup = false;
		try {
			if (existsSync(updatesDir)) {
				const entries = readdirSync(updatesDir);
				hasBackup = entries.some((e) => e.startsWith("rollback-"));
			}
		} catch {
			// Can't read dir — will let bench-updater report the error
		}

		if (!hasBackup) {
			return c.json({ error: "No rollback backup available" }, 400);
		}

		// Execute rollback
		const proc = Bun.spawn(["sudo", "bench-updater", "rollback"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		if (exitCode !== 0) {
			console.error(
				`[update.rollback] bench-updater failed (exit ${exitCode}): ${(stderr + stdout).trim()}`,
			);
			logAudit(db, user.id, "update.rollback.failed", `Exit code ${exitCode}`);
			return c.json({ error: "Rollback failed. Check system logs for details." }, 500);
		}

		logAudit(db, user.id, "update.rollback", `Manual rollback from ${NORON_VERSION}`);

		return c.json({ message: "Rollback complete", previousVersion: NORON_VERSION });
	});

	// GET /update/history — past updates
	app.get("/update/history", (c) => {
		const updates = db
			.query("SELECT * FROM updates ORDER BY started_at DESC LIMIT 20")
			.all() as UpdateRow[];

		return c.json({
			currentVersion: NORON_VERSION,
			updates: updates.map((u) => ({
				id: u.id,
				version: u.version,
				state: u.state,
				startedAt: u.started_at,
				completedAt: u.completed_at,
				error: u.error,
			})),
		});
	});

	return app;
}
