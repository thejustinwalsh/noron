import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { VIOLATION_STRIKE_LIMIT } from "@noron/shared";
import { recordViolation } from "../routes/violations";

function createTestDb(): Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys=ON");
	db.exec(`
		CREATE TABLE runners (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'offline',
			disabled_at INTEGER,
			disabled_reason TEXT,
			job_timeout_ms INTEGER
		)
	`);
	db.exec(`
		CREATE TABLE violations (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			job_id TEXT,
			run_id TEXT,
			reason TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			runner_id TEXT REFERENCES runners(id)
		)
	`);
	return db;
}

describe("recordViolation", () => {
	let db: Database;

	beforeEach(() => {
		db = createTestDb();
	});

	afterEach(() => {
		db.close();
	});

	test("records a violation in the DB", () => {
		const result = recordViolation(db, "org/repo", "job-1", "run-1", "timeout exceeded");

		expect(result.recorded).toBe(true);
		expect(result.strikeCount).toBe(1);
		expect(result.disabled).toBe(false);

		const rows = db.query("SELECT * FROM violations WHERE repo = ?").all("org/repo") as {
			repo: string;
			job_id: string;
			run_id: string;
			reason: string;
		}[];
		expect(rows).toHaveLength(1);
		expect(rows[0].repo).toBe("org/repo");
		expect(rows[0].job_id).toBe("job-1");
		expect(rows[0].run_id).toBe("run-1");
		expect(rows[0].reason).toBe("timeout exceeded");
	});

	test("returns correct strike count", () => {
		recordViolation(db, "org/repo", "job-1", "run-1", "reason 1");
		const result = recordViolation(db, "org/repo", "job-2", "run-2", "reason 2");

		expect(result.strikeCount).toBe(2);
		expect(result.disabled).toBe(false);
	});

	test("after VIOLATION_STRIKE_LIMIT violations, returns disabled=true and updates runner status", () => {
		// Insert a runner for the repo
		const runnerId = crypto.randomUUID();
		db.run("INSERT INTO runners (id, repo, status) VALUES (?, ?, ?)", [
			runnerId,
			"org/repo",
			"online",
		]);

		// Record violations up to the limit
		for (let i = 1; i < VIOLATION_STRIKE_LIMIT; i++) {
			const result = recordViolation(db, "org/repo", `job-${i}`, `run-${i}`, `reason ${i}`);
			expect(result.disabled).toBe(false);
		}

		// The strike that hits the limit should disable
		const result = recordViolation(
			db,
			"org/repo",
			`job-${VIOLATION_STRIKE_LIMIT}`,
			`run-${VIOLATION_STRIKE_LIMIT}`,
			"final strike",
		);

		expect(result.strikeCount).toBe(VIOLATION_STRIKE_LIMIT);
		expect(result.disabled).toBe(true);

		// Verify the runner was actually disabled in the DB
		const runner = db
			.query("SELECT status, disabled_reason FROM runners WHERE id = ?")
			.get(runnerId) as {
			status: string;
			disabled_reason: string;
		};
		expect(runner.status).toBe("disabled");
		expect(runner.disabled_reason).toContain(`${VIOLATION_STRIKE_LIMIT} violations`);
	});

	test("does not disable when no runner exists for repo", () => {
		for (let i = 0; i < VIOLATION_STRIKE_LIMIT + 1; i++) {
			recordViolation(db, "org/no-runner", `job-${i}`, `run-${i}`, "reason");
		}
		const result = recordViolation(db, "org/no-runner", "job-x", "run-x", "reason");
		// Strike count exceeds limit but no runner to disable
		expect(result.disabled).toBe(false);
	});

	test("links violation to runner when runner exists", () => {
		const runnerId = crypto.randomUUID();
		db.run("INSERT INTO runners (id, repo, status) VALUES (?, ?, ?)", [
			runnerId,
			"org/repo",
			"online",
		]);

		recordViolation(db, "org/repo", "job-1", "run-1", "test reason");

		const violation = db
			.query("SELECT runner_id FROM violations WHERE repo = ?")
			.get("org/repo") as {
			runner_id: string | null;
		};
		expect(violation.runner_id).toBe(runnerId);
	});
});

describe("violationRoutes does not expose POST /violations", () => {
	test("violationRoutes has no POST /violations endpoint", async () => {
		const { violationRoutes } = await import("../routes/violations");
		const { Hono } = await import("hono");
		const db = new Database(":memory:");
		db.exec("PRAGMA foreign_keys=ON");
		// Minimal schema for route initialization
		db.exec(`
			CREATE TABLE users (
				id TEXT PRIMARY KEY,
				github_id INTEGER UNIQUE NOT NULL,
				github_login TEXT NOT NULL,
				role TEXT NOT NULL DEFAULT 'user',
				created_at INTEGER NOT NULL,
				last_seen_at INTEGER,
				github_token TEXT,
				github_scope TEXT DEFAULT 'read:user',
				github_pat TEXT
			)
		`);
		db.exec(`
			CREATE TABLE device_codes (
				code TEXT PRIMARY KEY,
				user_code TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				user_id TEXT REFERENCES users(id),
				token TEXT,
				code_verifier TEXT,
				session_expires_at INTEGER
			)
		`);
		db.exec(`
			CREATE TABLE violations (
				id TEXT PRIMARY KEY,
				repo TEXT NOT NULL,
				job_id TEXT,
				run_id TEXT,
				reason TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				runner_id TEXT
			)
		`);
		db.exec(`
			CREATE TABLE runners (
				id TEXT PRIMARY KEY,
				repo TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'offline',
				disabled_at INTEGER,
				disabled_reason TEXT,
				job_timeout_ms INTEGER
			)
		`);

		const app = new Hono();
		app.route("/api", violationRoutes(db));

		const res = await app.request("/api/violations", { method: "POST" });
		// Should be 404 (no route) or 405 (method not allowed), not 200
		expect([404, 405]).toContain(res.status);

		db.close();
	});
});
