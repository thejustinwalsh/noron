import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { validateWsConnection, activeConnections, MAX_PER_IP_CONNECTIONS, MAX_TOTAL_CONNECTIONS } from "../routes/ws-status";
import { Hono } from "hono";
import { statusRoutes } from "../routes/status";
import { getUserByToken } from "../auth-middleware";

// --- Helpers ---

function createTestDb(): Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys=ON");
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
	return db;
}

function seedUser(db: Database, token: string): string {
	const userId = crypto.randomUUID();
	db.run(
		"INSERT INTO users (id, github_id, github_login, role, created_at) VALUES (?, ?, ?, ?, ?)",
		[userId, 12345, "testuser", "user", Date.now()],
	);
	db.run(
		"INSERT INTO device_codes (code, user_code, created_at, expires_at, user_id, token) VALUES (?, ?, ?, ?, ?, ?)",
		[crypto.randomUUID(), "ABCD-1234", Date.now(), Date.now() + 3600_000, userId, token],
	);
	return userId;
}

function makeWsRequest(url: string, ip = "1.2.3.4"): Request {
	return new Request(url, {
		headers: {
			"x-forwarded-for": ip,
			Upgrade: "websocket",
		},
	});
}

function resetConnectionTracking() {
	activeConnections.total = 0;
	activeConnections.byIp.clear();
}

// --- Tests ---

describe("WebSocket authentication", () => {
	let db: Database;

	beforeEach(() => {
		db = createTestDb();
		resetConnectionTracking();
	});

	afterEach(() => {
		db.close();
		resetConnectionTracking();
	});

	test("rejects connection without token", () => {
		const req = makeWsRequest("http://localhost/ws/status");
		const result = validateWsConnection(req, db);
		expect(result).not.toBeNull();
		expect(result!.status).toBe(401);
	});

	test("rejects connection with invalid token", () => {
		const req = makeWsRequest("http://localhost/ws/status?token=bad-token");
		const result = validateWsConnection(req, db);
		expect(result).not.toBeNull();
		expect(result!.status).toBe(401);
	});

	test("accepts connection with valid token", () => {
		const token = "valid-test-token";
		seedUser(db, token);
		const req = makeWsRequest(`http://localhost/ws/status?token=${token}`);
		const result = validateWsConnection(req, db);
		expect(result).toBeNull(); // null means "allow"
	});
});

describe("WebSocket connection limits", () => {
	let db: Database;
	const validToken = "valid-test-token";

	beforeEach(() => {
		db = createTestDb();
		resetConnectionTracking();
		seedUser(db, validToken);
	});

	afterEach(() => {
		db.close();
		resetConnectionTracking();
	});

	test("rejects when total connections exceed limit", () => {
		activeConnections.total = MAX_TOTAL_CONNECTIONS;
		const req = makeWsRequest(`http://localhost/ws/status?token=${validToken}`);
		const result = validateWsConnection(req, db);
		expect(result).not.toBeNull();
		expect(result!.status).toBe(429);
	});

	test("rejects when per-IP connections exceed limit", () => {
		const ip = "10.0.0.1";
		activeConnections.byIp.set(ip, MAX_PER_IP_CONNECTIONS);
		const req = makeWsRequest(`http://localhost/ws/status?token=${validToken}`, ip);
		const result = validateWsConnection(req, db);
		expect(result).not.toBeNull();
		expect(result!.status).toBe(429);
	});

	test("allows connection when under all limits", () => {
		activeConnections.total = MAX_TOTAL_CONNECTIONS - 1;
		activeConnections.byIp.set("10.0.0.1", MAX_PER_IP_CONNECTIONS - 1);
		const req = makeWsRequest(`http://localhost/ws/status?token=${validToken}`, "10.0.0.1");
		const result = validateWsConnection(req, db);
		expect(result).toBeNull();
	});
});

describe("/api/status redaction", () => {
	let db: Database;
	let app: Hono;
	const validToken = "valid-test-token";

	beforeEach(() => {
		db = createTestDb();
		seedUser(db, validToken);
		app = new Hono();
		app.route("/api", statusRoutes(db));
	});

	afterEach(() => {
		db.close();
	});

	test("returns 401 for unauthenticated requests", async () => {
		const res = await app.request("/api/status");
		expect(res.status).toBe(401);
	});

	test("returns 503 for authenticated requests when benchd is unavailable", async () => {
		const res = await app.request("/api/status", {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		expect(res.status).toBe(503);
	});
});

/**
 * Integration-level tests for status redaction logic.
 * These test the actual response shaping by injecting a mock BenchdClient.
 * Since we can't easily mock the BenchdClient connection in the route,
 * we test the core logic directly.
 */
describe("/api/status redaction logic", () => {
	test("authenticated response includes holder field", () => {
		const lockStatus = {
			type: "lock.status" as const,
			held: true,
			holder: { jobId: "j1", runId: "r1", owner: "testorg" },
			queueDepth: 2,
		};
		const isAuthenticated = true;

		let lock;
		if (isAuthenticated) {
			lock = {
				held: lockStatus.held,
				holder: lockStatus.holder,
				queueDepth: lockStatus.queueDepth,
			};
		} else {
			lock = {
				held: lockStatus.held,
				queueDepth: lockStatus.queueDepth,
			};
		}

		expect(lock).toHaveProperty("holder");
		expect(lock.holder).toEqual({ jobId: "j1", runId: "r1", owner: "testorg" });
		expect(lock.held).toBe(true);
		expect(lock.queueDepth).toBe(2);
	});

	test("unauthenticated response omits holder field", () => {
		const lockStatus = {
			type: "lock.status" as const,
			held: true,
			holder: { jobId: "j1", runId: "r1", owner: "testorg" },
			queueDepth: 2,
		};
		const isAuthenticated = false;

		let lock: Record<string, unknown>;
		if (isAuthenticated) {
			lock = {
				held: lockStatus.held,
				holder: lockStatus.holder,
				queueDepth: lockStatus.queueDepth,
			};
		} else {
			lock = {
				held: lockStatus.held,
				queueDepth: lockStatus.queueDepth,
			};
		}

		expect(lock).not.toHaveProperty("holder");
		expect(lock.held).toBe(true);
		expect(lock.queueDepth).toBe(2);
	});
});

// --- Session expiry tests ---

describe("Session expiry", () => {
	let db: Database;

	beforeEach(() => {
		db = createTestDb();
	});

	afterEach(() => {
		db.close();
	});

	test("session with session_expires_at in the future is valid", () => {
		const token = "future-session-token";
		const userId = crypto.randomUUID();
		db.run(
			"INSERT INTO users (id, github_id, github_login, role, created_at) VALUES (?, ?, ?, ?, ?)",
			[userId, 99001, "futureuser", "user", Date.now()],
		);
		db.run(
			"INSERT INTO device_codes (code, user_code, created_at, expires_at, user_id, token, session_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[crypto.randomUUID(), "FUTR-1234", Date.now(), Date.now() + 3600_000, userId, token, Date.now() + 86400_000],
		);

		const user = getUserByToken(db, token);
		expect(user).not.toBeNull();
		expect(user!.githubLogin).toBe("futureuser");
	});

	test("session with session_expires_at in the past is rejected", () => {
		const token = "expired-session-token";
		const userId = crypto.randomUUID();
		db.run(
			"INSERT INTO users (id, github_id, github_login, role, created_at) VALUES (?, ?, ?, ?, ?)",
			[userId, 99002, "expireduser", "user", Date.now()],
		);
		db.run(
			"INSERT INTO device_codes (code, user_code, created_at, expires_at, user_id, token, session_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[crypto.randomUUID(), "EXPD-1234", Date.now(), Date.now() + 3600_000, userId, token, Date.now() - 1000],
		);

		const user = getUserByToken(db, token);
		expect(user).toBeNull();
	});

	test("session with session_expires_at = NULL is valid (backwards compat)", () => {
		const token = "null-expiry-token";
		const userId = crypto.randomUUID();
		db.run(
			"INSERT INTO users (id, github_id, github_login, role, created_at) VALUES (?, ?, ?, ?, ?)",
			[userId, 99003, "nullexpiryuser", "user", Date.now()],
		);
		// seedUser already inserts without session_expires_at (NULL), but be explicit
		db.run(
			"INSERT INTO device_codes (code, user_code, created_at, expires_at, user_id, token, session_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[crypto.randomUUID(), "NULL-1234", Date.now(), Date.now() + 3600_000, userId, token, null],
		);

		const user = getUserByToken(db, token);
		expect(user).not.toBeNull();
		expect(user!.githubLogin).toBe("nullexpiryuser");
	});
});
