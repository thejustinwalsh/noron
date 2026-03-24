import type { Database } from "bun:sqlite";
import { type BenchdConfig, BenchdClient, SOCKET_PATH, TOKEN_EXPIRY_HOURS } from "@noron/shared";
import * as z from "@zod/mini";
import { Hono } from "hono";
import { extractToken, getUserByToken } from "../auth-middleware";
import { decryptToken } from "../crypto";

/** Positive integer page number (query param arrives as string) */
const PageParam = z.coerce.number().check(z.int(), z.minimum(1));

const GitHubRepo = z.object({
	full_name: z.string(),
	private: z.boolean(),
	description: z.nullable(z.string()),
});

export function adminRoutes(db: Database, appConfig: BenchdConfig): Hono {
	const app = new Hono();

	// Get system config from benchd (requires auth — used by dashboard)
	app.get("/config", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);
		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const client = new BenchdClient(process.env.BENCHD_SOCKET ?? SOCKET_PATH);
		try {
			await client.connect();
			const config = await client.request({
				type: "config.get",
				requestId: crypto.randomUUID(),
			});
			client.close();

			if (config.type === "config.get") {
				return c.json({
					isolatedCores: config.isolatedCores,
					housekeepingCore: config.housekeepingCore,
					totalCores: config.totalCores,
					thermalZones: config.thermalZones,
					configPath: config.configPath,
					runnerLabel: appConfig.runnerLabel,
				});
			}
			return c.json({ error: "Unexpected response from benchd" }, 500);
		} catch {
			client.close();
			return c.json({ error: "Cannot reach benchd daemon" }, 503);
		}
	});

	// List all invites (admin only)
	app.get("/invites", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

		const invites = db
			.query(
				`SELECT id, token, created_at as createdAt, expires_at as expiresAt,
				        used_at as usedAt, used_by as usedBy
				 FROM invites ORDER BY created_at DESC`,
			)
			.all() as Array<{
			id: string;
			token: string;
			createdAt: number;
			expiresAt: number;
			usedAt: number | null;
			usedBy: string | null;
		}>;

		return c.json(invites);
	});

	// Create a new invite (admin only)
	app.post("/invites", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

		const id = crypto.randomUUID();
		const inviteToken = crypto.randomUUID();
		const now = Date.now();
		const expiresAt = now + TOKEN_EXPIRY_HOURS * 3600_000;

		db.query("INSERT INTO invites (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
			id,
			inviteToken,
			now,
			expiresAt,
		);

		return c.json({
			id,
			token: inviteToken,
			createdAt: now,
			expiresAt,
			usedAt: null,
			usedBy: null,
		});
	});

	// List GitHub repos for the authenticated user (proxies one page of GitHub API)
	app.get("/github/repos", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		if (!user.githubToken) return c.json([]);

		const pageParsed = z.safeParse(PageParam, c.req.query("page") ?? "1");
		const page = pageParsed.success ? pageParsed.data : 1;
		const decryptedToken = await decryptToken(user.githubToken);
		const res = await fetch(
			`https://api.github.com/user/repos?per_page=100&sort=pushed&type=all&page=${page}`,
			{
				headers: {
					Authorization: `Bearer ${decryptedToken}`,
					Accept: "application/vnd.github+json",
				},
			},
		);

		if (!res.ok) return c.json([]);

		const parsed = z.safeParse(z.array(GitHubRepo), await res.json());
		if (!parsed.success) return c.json([]);

		return c.json(
			parsed.data.map((r) => ({
				fullName: r.full_name,
				private: r.private,
				description: r.description,
			})),
		);
	});

	return app;
}
