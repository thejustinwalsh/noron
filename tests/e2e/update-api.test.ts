import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { uniquePaths } from "./helpers/fixtures";
import { findAvailablePort } from "./helpers/ports";
import { TestServices } from "./helpers/services";

function seedTestUser(dbPath: string): string {
	const db = new Database(dbPath);
	const userId = crypto.randomUUID();
	const token = crypto.randomUUID();
	db.run(
		"INSERT OR IGNORE INTO users (id, github_id, github_login, role, created_at) VALUES (?, 99998, 'update-test', 'admin', ?)",
		[userId, Date.now()],
	);
	db.run(
		"INSERT INTO device_codes (code, user_code, created_at, expires_at, user_id, token) VALUES (?, 'UPDTEST', ?, ?, ?, ?)",
		[crypto.randomUUID(), Date.now(), Date.now() + 3600_000, userId, token],
	);
	db.close();
	return token;
}

describe("Update API", () => {
	let services: TestServices;
	let authToken: string;

	beforeAll(async () => {
		const paths = uniquePaths("update-api");
		const port = await findAvailablePort();
		services = await TestServices.start({ ...paths, port });
		authToken = seedTestUser(paths.dbPath);
	}, 30_000);

	afterAll(async () => {
		await services?.shutdown();
	});

	function authFetch(path: string, opts?: RequestInit) {
		return fetch(`http://localhost:${services.port}${path}`, {
			...opts,
			headers: { Authorization: `Bearer ${authToken}`, ...opts?.headers },
		});
	}

	test("GET /api/update/status returns current version", async () => {
		const res = await authFetch("/api/update/status");
		expect(res.ok).toBe(true);

		const data = (await res.json()) as {
			currentVersion: string;
			updateRepo: string | null;
			autoUpdate: boolean;
			latest: unknown;
		};

		expect(data.currentVersion).toBeDefined();
		expect(typeof data.currentVersion).toBe("string");
		expect(typeof data.autoUpdate).toBe("boolean");
		// No updates yet
		expect(data.latest).toBeNull();
	});

	test("GET /api/update/history returns empty list", async () => {
		const res = await authFetch("/api/update/history");
		expect(res.ok).toBe(true);

		const data = (await res.json()) as {
			currentVersion: string;
			updates: unknown[];
		};

		expect(data.currentVersion).toBeDefined();
		expect(data.updates).toEqual([]);
	});

	test("POST /api/update/check returns 400 when update_repo not configured", async () => {
		const res = await authFetch("/api/update/check", { method: "POST" });
		// update_repo is empty in test config, so this should fail gracefully
		expect(res.status).toBe(400);

		const data = (await res.json()) as { error: string };
		expect(data.error).toContain("update_repo");
	});

	test("POST /api/update/apply returns 400 when update_repo not configured", async () => {
		const res = await authFetch("/api/update/apply", { method: "POST" });
		expect(res.status).toBe(400);
	});

	test("unauthenticated requests return 401", async () => {
		const res = await fetch(`http://localhost:${services.port}/api/update/status`);
		expect(res.status).toBe(401);
	});
});
