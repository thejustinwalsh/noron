import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

function createTestDb(): Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode=WAL");
	db.exec("PRAGMA foreign_keys=ON");
	db.exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			github_id INTEGER UNIQUE NOT NULL,
			github_login TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			created_at INTEGER NOT NULL,
			github_token TEXT
		)
	`);
	db.exec(`
		CREATE TABLE runners (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			owner_id TEXT NOT NULL REFERENCES users(id),
			repo TEXT NOT NULL,
			registered_at INTEGER NOT NULL,
			status TEXT DEFAULT 'offline',
			callback_token TEXT,
			status_message TEXT
		)
	`);
	db.exec("CREATE UNIQUE INDEX idx_runners_repo ON runners(repo)");
	return db;
}

function insertUser(db: Database, id: string) {
	db.run(
		"INSERT INTO users (id, github_id, github_login, role, created_at, github_token) VALUES (?, ?, ?, 'admin', ?, 'ghp_test')",
		[id, Math.floor(Math.random() * 100000), `user-${id}`, Date.now()],
	);
}

function insertRunner(db: Database, id: string, repo: string, userId: string, status = "offline") {
	db.run(
		"INSERT INTO runners (id, name, owner_id, repo, registered_at, status) VALUES (?, ?, ?, ?, ?, ?)",
		[id, `runner-${id}`, userId, repo, Date.now(), status],
	);
}

describe("concurrent provisioning - DB integrity", () => {
	let db: Database;

	beforeEach(() => {
		db = createTestDb();
		insertUser(db, "u1");
	});

	afterEach(() => {
		db.close();
	});

	test("unique repo constraint prevents duplicate runners", () => {
		insertRunner(db, "r1", "org/repo-a", "u1");
		expect(() => insertRunner(db, "r2", "org/repo-a", "u1")).toThrow();
	});

	test("concurrent status updates don't corrupt each other", () => {
		insertRunner(db, "r1", "org/repo-a", "u1");
		insertRunner(db, "r2", "org/repo-b", "u1");

		db.run("UPDATE runners SET status = 'provisioning' WHERE id = ?", ["r1"]);
		db.run("UPDATE runners SET status = 'provisioning' WHERE id = ?", ["r2"]);

		const r1 = db.query("SELECT status FROM runners WHERE id = 'r1'").get() as { status: string };
		const r2 = db.query("SELECT status FROM runners WHERE id = 'r2'").get() as { status: string };
		expect(r1.status).toBe("provisioning");
		expect(r2.status).toBe("provisioning");
	});

	test("provision and deprovision don't interfere across repos", () => {
		insertRunner(db, "r1", "org/repo-a", "u1", "online");
		insertRunner(db, "r2", "org/repo-b", "u1");

		// Deprovision r1
		db.run("UPDATE runners SET status = 'removing' WHERE id = ?", ["r1"]);
		db.run("DELETE FROM runners WHERE id = ?", ["r1"]);

		// Provision r2
		db.run("UPDATE runners SET status = 'provisioning' WHERE id = ?", ["r2"]);
		db.run("UPDATE runners SET callback_token = ? WHERE id = ?", [crypto.randomUUID(), "r2"]);

		const r1 = db.query("SELECT * FROM runners WHERE id = 'r1'").get();
		const r2 = db.query("SELECT status, callback_token FROM runners WHERE id = 'r2'").get() as {
			status: string;
			callback_token: string;
		};
		expect(r1).toBeNull();
		expect(r2.status).toBe("provisioning");
		expect(r2.callback_token).toBeTruthy();
	});

	test("rapid provision/deprovision cycle leaves clean state", () => {
		for (let i = 0; i < 5; i++) {
			const rid = `r-cycle-${i}`;
			const repo = "org/cycle-repo";
			db.run("DELETE FROM runners WHERE repo = ?", [repo]);
			insertRunner(db, rid, repo, "u1", "provisioning");
			db.run("UPDATE runners SET status = 'online' WHERE id = ?", [rid]);
			db.run("UPDATE runners SET status = 'removing' WHERE id = ?", [rid]);
			db.run("DELETE FROM runners WHERE id = ?", [rid]);
		}

		const count = db.query("SELECT COUNT(*) as count FROM runners").get() as { count: number };
		expect(count.count).toBe(0);
	});
});
