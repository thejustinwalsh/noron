import type { Database } from "bun:sqlite";
import { BenchdClient, SOCKET_PATH } from "@noron/shared";
import * as z from "@zod/mini";
import { Hono } from "hono";
import { extractToken, getUserByToken } from "../auth-middleware";
import { encryptToken } from "../crypto";
import { logAudit } from "../db";
import { startDeprovisionWorkflow } from "../workflows/deprovision-runner";
import { startProvisionWorkflow } from "../workflows/provision-runner";

/** Runner name: alphanumeric, dots, underscores, hyphens. Matches runner-ctl validate_name. */
const RunnerName = z.string().check(z.regex(/^[a-zA-Z0-9._-]+$/), z.minLength(1), z.maxLength(64));

/** GitHub repo: owner/name format */
const RepoSlug = z.string().check(z.regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/), z.maxLength(200));

const CreateRunnerBody = z.object({
	name: RunnerName,
	repo: RepoSlug,
});

export function statusRoutes(db: Database): Hono {
	const app = new Hono();

	// Status endpoint — requires authentication
	app.get("/status", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);
		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const client = new BenchdClient(process.env.BENCHD_SOCKET ?? SOCKET_PATH);
		try {
			await client.connect();

			const [lockStatus, thermalStatus] = await Promise.all([
				client.request({
					type: "lock.status",
					requestId: crypto.randomUUID(),
				}),
				client.request({
					type: "thermal.status",
					requestId: crypto.randomUUID(),
				}),
			]);

			client.close();

			const lock =
				lockStatus.type === "lock.status"
					? {
							held: lockStatus.held,
							holder: lockStatus.holder,
							queueDepth: lockStatus.queueDepth,
						}
					: null;

			return c.json({
				lock,
				thermal:
					thermalStatus.type === "thermal.status"
						? {
								currentTemp: thermalStatus.currentTemp,
								trend: thermalStatus.trend,
							}
						: null,
			});
		} catch {
			client.close();
			return c.json({ error: "Cannot reach benchd daemon" }, 503);
		}
	});

	// Authenticated: list runners for the current user
	app.get("/runners", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		// Admins see all runners, regular users see only their own
		const runners =
			user.role === "admin"
				? db
						.query(
							"SELECT id, name, repo, owner_id, registered_at, last_heartbeat, status, status_message, job_timeout_ms, disabled_at, disabled_reason FROM runners ORDER BY registered_at DESC",
						)
						.all()
				: db
						.query(
							"SELECT id, name, repo, owner_id, registered_at, last_heartbeat, status, status_message, job_timeout_ms, disabled_at, disabled_reason FROM runners WHERE owner_id = ? ORDER BY registered_at DESC",
						)
						.all(user.id);

		// Attach violation counts per runner
		const windowStart = Date.now() - 30 * 24 * 3600_000;
		const runnersWithViolations = (runners as Record<string, unknown>[]).map((r) => {
			const count = db
				.query("SELECT COUNT(*) as count FROM violations WHERE repo = ? AND created_at > ?")
				.get(r.repo as string, windowStart) as { count: number } | null;
			return {
				...r,
				violationCount: count?.count ?? 0,
			};
		});

		return c.json(runnersWithViolations);
	});

	// Authenticated: register a new runner + trigger provisioning workflow
	app.post("/runners", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const raw = await c.req.json();
		const parsed = z.safeParse(CreateRunnerBody, raw);
		if (!parsed.success) {
			return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
		}
		const body = parsed.data;

		if (!user.githubPat && !user.githubToken) {
			return c.json(
				{ error: "GitHub token not found — re-authenticate with GitHub or add a PAT" },
				400,
			);
		}

		// Check for duplicate repo registration
		const existing = db.query("SELECT id FROM runners WHERE repo = ?").get(body.repo) as {
			id: string;
		} | null;
		if (existing) {
			return c.json({ error: "This repo is already registered" }, 409);
		}

		const id = crypto.randomUUID();
		db.run(
			"INSERT INTO runners (id, name, owner_id, repo, registered_at, status) VALUES (?, ?, ?, ?, ?, 'pending')",
			[id, body.name, user.id, body.repo, Date.now()],
		);

		// Trigger durable provisioning workflow (returns immediately).
		// If this fails, clean up the runner record so we don't leave an orphaned 'pending' row.
		let workflowRunId: string;
		try {
			workflowRunId = await startProvisionWorkflow({
				runnerId: id,
				name: body.name,
				repo: body.repo,
				userId: user.id,
			});
		} catch (err) {
			db.run("DELETE FROM runners WHERE id = ?", [id]);
			throw err;
		}

		// Store workflow run ID for status tracking
		db.run("UPDATE runners SET workflow_run_id = ? WHERE id = ?", [workflowRunId, id]);

		return c.json(
			{
				id,
				name: body.name,
				repo: body.repo,
				status: "pending",
				lastHeartbeat: null,
			},
			201,
		);
	});

	// Authenticated: remove a runner (triggers deprovisioning workflow)
	app.delete("/runners/:id", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const runnerId = c.req.param("id");
		const runner = db
			.query("SELECT name, repo, owner_id, status FROM runners WHERE id = ?")
			.get(runnerId) as { name: string; repo: string; owner_id: string; status: string } | null;

		if (!runner) return c.json({ error: "Runner not found" }, 404);

		// Only owner or admin can delete
		if (runner.owner_id !== user.id && user.role !== "admin") {
			return c.json({ error: "Forbidden" }, 403);
		}

		if (!user.githubPat && !user.githubToken) {
			// No GitHub token — just delete the DB record without cleanup
			db.run("DELETE FROM violations WHERE runner_id = ?", [runnerId]);
			db.run("DELETE FROM runners WHERE id = ?", [runnerId]);
			return c.json({ ok: true });
		}

		// Runners that aren't actively running have nothing to clean up —
		// skip the deprovision workflow and just delete the DB record.
		if (runner.status === "pending" || runner.status === "failed" || runner.status === "offline") {
			db.run("DELETE FROM violations WHERE runner_id = ?", [runnerId]);
			db.run("DELETE FROM runners WHERE id = ?", [runnerId]);
			return c.json({ ok: true });
		}

		// Trigger durable deprovisioning workflow
		await startDeprovisionWorkflow({
			runnerId,
			name: runner.name,
			repo: runner.repo,
			userId: user.id,
		});

		return c.json({ ok: true, status: "removing" });
	});

	// Callback from container — start.sh calls this after successful registration.
	// Auth: one-time callback_token generated during provisioning, passed in POST body.
	app.post("/runners/:id/callback", async (c) => {
		const runnerId = c.req.param("id");
		let cbToken: string | undefined;
		try {
			const body = await c.req.json<{ token?: string }>();
			cbToken = body.token;
		} catch {
			// No valid JSON body
		}
		if (!cbToken) return c.json({ error: "Missing callback token" }, 401);

		const runner = db
			.query("SELECT status, callback_token FROM runners WHERE id = ?")
			.get(runnerId) as { status: string; callback_token: string | null } | null;

		if (!runner) return c.json({ error: "Runner not found" }, 404);
		if (runner.status !== "provisioning" && runner.status !== "healing") {
			return c.json({ error: "Runner not in provisioning/healing state" }, 409);
		}
		if (!runner.callback_token || runner.callback_token !== cbToken) {
			return c.json({ error: "Invalid callback token" }, 403);
		}

		// Set online + consume the token (one-time use)
		db.run("UPDATE runners SET status = 'online', callback_token = NULL WHERE id = ?", [runnerId]);
		return c.json({ ok: true });
	});

	// Runner status — returns current status from DB + live container check
	app.get("/runners/:id/status", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const runnerId = c.req.param("id");
		const runner = db
			.query(
				"SELECT id, name, repo, status, status_message, workflow_run_id FROM runners WHERE id = ?",
			)
			.get(runnerId) as {
			id: string;
			name: string;
			repo: string;
			status: string;
			status_message: string | null;
			workflow_run_id: string | null;
		} | null;

		if (!runner) return c.json({ error: "Runner not found" }, 404);

		return c.json({
			id: runner.id,
			name: runner.name,
			repo: runner.repo,
			status: runner.status,
			statusMessage: runner.status_message,
		});
	});

	// ---- Auth/User info endpoints ----

	// Return current user state for dashboard
	app.get("/auth/me", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const runnerCount = db
			.query("SELECT COUNT(*) as count FROM runners WHERE owner_id = ?")
			.get(user.id) as { count: number };

		const hasRepoScope = !!user.githubPat || (user.githubScope ?? "").includes("repo");

		return c.json({
			login: user.githubLogin,
			role: user.role,
			hasRepoScope,
			hasPat: !!user.githubPat,
			runnerCount: runnerCount.count,
		});
	});

	// Save a fine-grained PAT
	app.post("/auth/pat", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const body = (await c.req.json()) as { pat?: string };
		if (!body.pat || typeof body.pat !== "string") {
			return c.json({ error: "Missing pat field" }, 400);
		}
		if (body.pat.length > 256) {
			return c.json({ error: "Token too long" }, 400);
		}

		// Validate PAT against GitHub API
		const ghRes = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${body.pat}`,
				Accept: "application/vnd.github+json",
			},
		});

		if (!ghRes.ok) {
			return c.json({ error: "Invalid token — GitHub rejected it" }, 400);
		}

		const ghUser = (await ghRes.json()) as { id: number; login: string };

		// Verify the PAT belongs to the same GitHub user
		const dbUser = db.query("SELECT github_id FROM users WHERE id = ?").get(user.id) as {
			github_id: number;
		} | null;

		if (!dbUser || dbUser.github_id !== ghUser.id) {
			return c.json({ error: "Token belongs to a different GitHub user" }, 403);
		}

		const encryptedPat = await encryptToken(body.pat);
		db.run("UPDATE users SET github_pat = ? WHERE id = ?", [encryptedPat, user.id]);
		logAudit(db, user.id, "pat.added");

		return c.json({ ok: true, login: ghUser.login });
	});

	// Clear a saved PAT
	app.delete("/auth/pat", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		db.run("UPDATE users SET github_pat = NULL WHERE id = ?", [user.id]);
		logAudit(db, user.id, "pat.removed");

		return c.json({ ok: true });
	});

	return app;
}
