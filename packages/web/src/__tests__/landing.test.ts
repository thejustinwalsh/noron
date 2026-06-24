import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { landingRoutes } from "../routes/landing";

function createTestDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE signup_applications (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			name TEXT,
			company TEXT,
			project_type TEXT NOT NULL,
			github_url TEXT,
			use_case TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			ip TEXT,
			user_agent TEXT
		)
	`);
	return db;
}

describe("landingRoutes", () => {
	test("renders self-hosting and approval language", async () => {
		const app = landingRoutes(createTestDb());
		const res = await app.request("/");
		const body = await res.text();

		expect(res.status).toBe(200);
		expect(body).toContain("Self-host Noron on Armbian-based single-board computers");
		expect(body).toContain("open source projects is available by approval");
		expect(body).toContain("Submitting this form does not grant a license");
	});

	test("stores valid signup applications", async () => {
		const db = createTestDb();
		const app = landingRoutes(db);
		const form = new URLSearchParams({
			email: "founder@example.com",
			name: "Founder",
			company: "Example OSS",
			project_type: "open-source",
			github_url: "https://github.com/example/project",
			use_case: "We want stable benchmarks for pull requests.",
		});

		const res = await app.request("/signup", {
			method: "POST",
			body: form,
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				"x-forwarded-for": "203.0.113.10",
				"user-agent": "bun-test",
			},
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/thanks");

		const row = db.query("SELECT * FROM signup_applications").get() as {
			email: string;
			project_type: string;
			github_url: string;
			ip: string;
			user_agent: string;
		};
		expect(row.email).toBe("founder@example.com");
		expect(row.project_type).toBe("open-source");
		expect(row.github_url).toBe("https://github.com/example/project");
		expect(row.ip).toBe("203.0.113.10");
		expect(row.user_agent).toBe("bun-test");
	});

	test("rejects invalid applications", async () => {
		const db = createTestDb();
		const app = landingRoutes(db);
		const form = new URLSearchParams({
			email: "not-an-email",
			project_type: "open-source",
			use_case: "too short",
		});

		const res = await app.request("/signup", {
			method: "POST",
			body: form,
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});

		expect(res.status).toBe(400);
		const count = db.query("SELECT COUNT(*) as count FROM signup_applications").get() as {
			count: number;
		};
		expect(count.count).toBe(0);
	});
});
