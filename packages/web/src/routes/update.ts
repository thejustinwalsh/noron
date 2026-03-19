import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { BenchdConfig } from "@noron/shared";
import { extractToken, getUserByToken } from "../auth-middleware";
import { checkForUpdate } from "../update-check";

const NORON_VERSION = process.env.NORON_VERSION ?? "dev";

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
			latest: latest
				? { version: latest.version, state: latest.state }
				: null,
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
