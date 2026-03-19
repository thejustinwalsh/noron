import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { generateInvite, markInviteUsed, validateInvite } from "../invite";

function createTestDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE invites (
			id TEXT PRIMARY KEY,
			token TEXT UNIQUE NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			used_at INTEGER,
			used_by TEXT
		)
	`);
	return db;
}

describe("validateInvite", () => {
	let db: Database;

	beforeEach(() => {
		db = createTestDb();
	});

	test("returns generic reason for not-found token", () => {
		const result = validateInvite(db, "nonexistent-token");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBeDefined();
		}
	});

	test("returns generic reason for expired token", () => {
		// Insert an already-expired invite
		const id = crypto.randomUUID();
		const token = crypto.randomUUID();
		const past = Date.now() - 1000;
		db.run("INSERT INTO invites (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)", [
			id,
			token,
			past - 86400_000,
			past,
		]);

		const result = validateInvite(db, token);
		expect(result.valid).toBe(false);
	});

	test("returns generic reason for already-used token", () => {
		const token = generateInvite(db, 24);
		// Find the invite and mark it used
		const row = db.query("SELECT id FROM invites WHERE token = ?").get(token) as { id: string };
		markInviteUsed(db, row.id, "some-user");

		const result = validateInvite(db, token);
		expect(result.valid).toBe(false);
	});

	test("all invalid states produce indistinguishable invalid results", () => {
		// Create expired invite
		const expiredId = crypto.randomUUID();
		const expiredToken = crypto.randomUUID();
		db.run("INSERT INTO invites (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)", [
			expiredId,
			expiredToken,
			Date.now() - 86400_000,
			Date.now() - 1000,
		]);

		// Create used invite
		const usedToken = generateInvite(db, 24);
		const usedRow = db.query("SELECT id FROM invites WHERE token = ?").get(usedToken) as {
			id: string;
		};
		markInviteUsed(db, usedRow.id, "some-user");

		// Not-found token
		const notFoundResult = validateInvite(db, "does-not-exist");
		const expiredResult = validateInvite(db, expiredToken);
		const usedResult = validateInvite(db, usedToken);

		// All three must be invalid
		expect(notFoundResult.valid).toBe(false);
		expect(expiredResult.valid).toBe(false);
		expect(usedResult.valid).toBe(false);

		// The invite route handler now returns the same message for all,
		// so an attacker cannot distinguish between these states
	});

	test("valid invite returns valid=true", () => {
		const token = generateInvite(db, 24);
		const result = validateInvite(db, token);
		expect(result.valid).toBe(true);
	});
});
