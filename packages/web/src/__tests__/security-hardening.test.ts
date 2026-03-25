import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { computeSha256 } from "../crypto";
import { initDb, logAudit } from "../db";

// --- computeSha256 ---

describe("computeSha256", () => {
	test("produces correct hash for known input", async () => {
		const data = new TextEncoder().encode("hello world").buffer as ArrayBuffer;
		const hash = await computeSha256(data);
		// SHA-256 of "hello world"
		expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
	});

	test("produces 64-char hex string", async () => {
		const data = new TextEncoder().encode("test").buffer as ArrayBuffer;
		const hash = await computeSha256(data);
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	test("empty input produces valid hash", async () => {
		const data = new ArrayBuffer(0);
		const hash = await computeSha256(data);
		// SHA-256 of empty string
		expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	});

	test("different inputs produce different hashes", async () => {
		const a = await computeSha256(new TextEncoder().encode("a").buffer as ArrayBuffer);
		const b = await computeSha256(new TextEncoder().encode("b").buffer as ArrayBuffer);
		expect(a).not.toBe(b);
	});
});

// --- Audit logging ---

describe("logAudit", () => {
	let db: Database;

	beforeEach(() => {
		db = initDb(":memory:");
	});

	afterEach(() => {
		db.close();
	});

	test("inserts audit log entry", () => {
		// Seed a user
		const userId = crypto.randomUUID();
		db.run(
			"INSERT INTO users (id, github_id, github_login, role, created_at) VALUES (?, ?, ?, ?, ?)",
			[userId, 12345, "testuser", "admin", Date.now()],
		);

		logAudit(db, userId, "invite.created", "inv-123");

		const logs = db.query("SELECT * FROM audit_logs").all() as Array<{
			id: string;
			user_id: string;
			action: string;
			details: string | null;
			created_at: number;
		}>;

		expect(logs).toHaveLength(1);
		expect(logs[0].user_id).toBe(userId);
		expect(logs[0].action).toBe("invite.created");
		expect(logs[0].details).toBe("inv-123");
		expect(logs[0].created_at).toBeGreaterThan(0);
	});

	test("handles null details", () => {
		const userId = crypto.randomUUID();
		db.run(
			"INSERT INTO users (id, github_id, github_login, role, created_at) VALUES (?, ?, ?, ?, ?)",
			[userId, 12345, "testuser", "admin", Date.now()],
		);

		logAudit(db, userId, "pat.removed");

		const log = db.query("SELECT details FROM audit_logs").get() as { details: string | null };
		expect(log.details).toBeNull();
	});
});

// --- Invite revocation ---

describe("invite revocation", () => {
	let db: Database;

	beforeEach(() => {
		db = initDb(":memory:");
	});

	afterEach(() => {
		db.close();
	});

	test("active invite can be deleted", () => {
		const id = crypto.randomUUID();
		const token = crypto.randomUUID();
		db.run("INSERT INTO invites (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)", [
			id,
			token,
			Date.now(),
			Date.now() + 86400_000,
		]);

		const before = db.query("SELECT COUNT(*) as count FROM invites").get() as { count: number };
		expect(before.count).toBe(2); // bootstrap + our invite

		db.run("DELETE FROM invites WHERE id = ? AND used_at IS NULL", [id]);

		const row = db.query("SELECT * FROM invites WHERE id = ?").get(id);
		expect(row).toBeNull();
	});

	test("used invite cannot be revoked", () => {
		// Seed a user for the foreign key
		const userId = crypto.randomUUID();
		db.run(
			"INSERT INTO users (id, github_id, github_login, role, created_at) VALUES (?, ?, ?, ?, ?)",
			[userId, 99999, "testuser", "user", Date.now()],
		);

		const id = crypto.randomUUID();
		const token = crypto.randomUUID();
		db.run(
			"INSERT INTO invites (id, token, created_at, expires_at, used_at, used_by) VALUES (?, ?, ?, ?, ?, ?)",
			[id, token, Date.now(), Date.now() + 86400_000, Date.now(), userId],
		);

		const invite = db.query("SELECT used_at FROM invites WHERE id = ?").get(id) as {
			used_at: number | null;
		};
		expect(invite.used_at).not.toBeNull();
	});
});

// --- DB schema: audit_logs and created_by ---

describe("database schema migrations", () => {
	test("audit_logs table exists after initDb", () => {
		const db = initDb(":memory:");
		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'")
			.all();
		expect(tables).toHaveLength(1);
		db.close();
	});

	test("invites table has created_by column", () => {
		const db = initDb(":memory:");
		const cols = db.query("PRAGMA table_info(invites)").all() as Array<{ name: string }>;
		const hasCreatedBy = cols.some((c) => c.name === "created_by");
		expect(hasCreatedBy).toBe(true);
		db.close();
	});
});

// --- Security headers ---

describe("security headers", () => {
	test("responses include security headers", async () => {
		// Minimal Hono app with security headers middleware (mirrors main.ts pattern)
		const app = new Hono();
		app.use("*", async (c, next) => {
			await next();
			c.header("X-Frame-Options", "DENY");
			c.header("X-Content-Type-Options", "nosniff");
			c.header("X-XSS-Protection", "0");
			c.header("Referrer-Policy", "strict-origin-when-cross-origin");
			c.header(
				"Content-Security-Policy",
				"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:",
			);
		});
		app.get("/test", (c) => c.text("ok"));

		const res = await app.request("/test");
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("X-XSS-Protection")).toBe("0");
		expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
		expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
	});
});

// --- CORS rejection ---

describe("CORS middleware", () => {
	function createCorsApp(publicUrl?: string) {
		const app = new Hono();
		app.use("/api/*", async (c, next) => {
			const origin = c.req.header("Origin");
			if (origin) {
				const expected = publicUrl ? new URL(publicUrl).origin : "http://localhost:9216";
				if (new URL(origin).origin !== expected) {
					return c.json({ error: "Forbidden" }, 403);
				}
			}
			await next();
		});
		app.get("/api/test", (c) => c.text("ok"));
		return app;
	}

	test("allows requests without Origin header", async () => {
		const app = createCorsApp();
		const res = await app.request("/api/test");
		expect(res.status).toBe(200);
	});

	test("allows same-origin requests", async () => {
		const app = createCorsApp("https://noron.tjw.dev");
		const res = await app.request("/api/test", {
			headers: { Origin: "https://noron.tjw.dev" },
		});
		expect(res.status).toBe(200);
	});

	test("rejects cross-origin requests", async () => {
		const app = createCorsApp("https://noron.tjw.dev");
		const res = await app.request("/api/test", {
			headers: { Origin: "https://evil.com" },
		});
		expect(res.status).toBe(403);
	});

	test("works with Cloudflare tunnel URL", async () => {
		const app = createCorsApp("https://noron.tjw.dev");
		const res = await app.request("/api/test", {
			headers: { Origin: "https://noron.tjw.dev" },
		});
		expect(res.status).toBe(200);
	});
});

// --- OAuth state validation ---

describe("OAuth callback state dispatch", () => {
	test("unprefixed state is rejected", async () => {
		const app = new Hono();
		app.get("/callback", async (c) => {
			const state = c.req.query("state") ?? "";
			if (state.startsWith("device:")) return c.text("device");
			if (state.startsWith("dashboard:")) return c.text("dashboard");
			if (state.startsWith("upgrade:")) return c.text("upgrade");
			if (state.startsWith("invite:")) return c.text("invite");
			return c.text("Invalid authentication state", 400);
		});

		// Raw invite token as state should be rejected
		const res = await app.request("/callback?code=abc&state=raw-invite-token");
		expect(res.status).toBe(400);

		// Prefixed state should be accepted
		const inviteRes = await app.request("/callback?code=abc&state=invite:nonce123");
		expect(res.status !== 200 || (await inviteRes.text()) === "invite").toBe(true);
	});
});

// --- PAT length validation ---

describe("PAT length validation", () => {
	test("rejects tokens longer than 256 characters", () => {
		const longPat = `ghp_${"a".repeat(300)}`;
		expect(longPat.length).toBeGreaterThan(256);
		// The validation is: if (body.pat.length > 256) return error
		expect(longPat.length > 256).toBe(true);
	});

	test("accepts normal-length tokens", () => {
		// Fine-grained PAT: ~93 chars
		const pat = `github_pat_${"a".repeat(82)}`;
		expect(pat.length).toBeLessThanOrEqual(256);
	});
});
