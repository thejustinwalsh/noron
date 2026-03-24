import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { RunnerCtlClient } from "@noron/shared";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { BenchGate } from "../../bench-gate";
import { encryptToken } from "../../crypto";
import {
	deleteRunner,
	getGithubToken,
	setGate,
	setWorkflowDb,
	updateRunnerStatus,
	withGate,
} from "../index";

// --- Test DB ---

let db: Database;
let ow: OpenWorkflow;

function initTestDb(): Database {
	const testDb = new Database(":memory:");
	testDb.exec("PRAGMA journal_mode=WAL");
	testDb.exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			github_id INTEGER UNIQUE NOT NULL,
			github_login TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			github_token TEXT,
			github_pat TEXT,
			created_at INTEGER NOT NULL,
			last_seen_at INTEGER
		)
	`);
	testDb.exec(`
		CREATE TABLE runners (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			owner_id TEXT NOT NULL,
			repo TEXT NOT NULL,
			registered_at INTEGER NOT NULL,
			last_heartbeat INTEGER,
			status TEXT DEFAULT 'offline',
			workflow_run_id TEXT,
			callback_token TEXT
		)
	`);
	return testDb;
}

function getRunnerStatus(runnerId: string): string | null {
	const row = db.query("SELECT status FROM runners WHERE id = ?").get(runnerId) as {
		status: string;
	} | null;
	return row?.status ?? null;
}

async function seedUser(id: string, token: string | null): Promise<void> {
	const encrypted = token ? await encryptToken(token) : null;
	db.run(
		"INSERT INTO users (id, github_id, github_login, role, github_token, created_at) VALUES (?, 12345, 'testuser', 'admin', ?, ?)",
		[id, encrypted, Date.now()],
	);
}

function seedRunner(id: string, name: string, repo: string, ownerId: string): void {
	db.run(
		"INSERT INTO runners (id, name, owner_id, repo, registered_at, status) VALUES (?, ?, ?, ?, ?, 'pending')",
		[id, name, ownerId, repo, Date.now()],
	);
}

beforeEach(() => {
	db = initTestDb();
	setWorkflowDb(db);
	setGate(new BenchGate());
	ow = new OpenWorkflow({ backend: BackendSqlite.connect(":memory:") });
});

afterEach(() => {
	db.close();
});

// --- Tests ---

describe("DB helpers", () => {
	test("getGithubToken returns stored token", async () => {
		await seedUser("user-1", "ghp_test123");
		expect(await getGithubToken("user-1")).toBe("ghp_test123");
	});

	test("getGithubToken returns null for missing user", async () => {
		expect(await getGithubToken("nonexistent")).toBeNull();
	});

	test("updateRunnerStatus updates correctly", async () => {
		await seedUser("user-1", "ghp_test");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");
		expect(getRunnerStatus("runner-1")).toBe("pending");
		updateRunnerStatus("runner-1", "provisioning");
		expect(getRunnerStatus("runner-1")).toBe("provisioning");
		updateRunnerStatus("runner-1", "online");
		expect(getRunnerStatus("runner-1")).toBe("online");
	});

	test("updateRunnerStatus is idempotent", async () => {
		await seedUser("user-1", "ghp_test");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");
		for (let i = 0; i < 5; i++) updateRunnerStatus("runner-1", "provisioning");
		expect(getRunnerStatus("runner-1")).toBe("provisioning");
	});

	test("deleteRunner removes record", async () => {
		await seedUser("user-1", "ghp_test");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");
		deleteRunner("runner-1");
		expect(getRunnerStatus("runner-1")).toBeNull();
	});

	test("deleteRunner on missing record is a no-op", () => {
		deleteRunner("nonexistent");
	});
});

describe("Provision Runner Workflow", () => {
	test("marks runner online on success", async () => {
		await seedUser("user-1", "ghp_test_token");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");

		const fetchSpy = spyOn(global, "fetch").mockResolvedValueOnce(
			Response.json({ token: "AABCDEF123" }),
		);

		const connectSpy = spyOn(RunnerCtlClient.prototype, "connect").mockResolvedValue();
		const requestSpy = spyOn(RunnerCtlClient.prototype, "request").mockResolvedValue({
			requestId: "mock",
			type: "provisioned",
			container: "bench-test-runner",
		});
		const closeSpy = spyOn(RunnerCtlClient.prototype, "close").mockImplementation(() => {});

		const workflow = ow.defineWorkflow<
			{ runnerId: string; name: string; repo: string; userId: string },
			{ status: "online" | "failed"; error?: string }
		>({ name: "test-provision" }, async ({ input, step }) => {
			try {
				await step.run({ name: "mark-provisioning" }, async () => {
					updateRunnerStatus(input.runnerId, "provisioning");
				});
				await step.run({ name: "provision-container" }, async () => {
					const ghToken = await getGithubToken(input.userId);
					if (!ghToken) throw new Error("No token");
					const res = await fetch(
						`https://api.github.com/repos/${input.repo}/actions/runners/registration-token`,
						{ method: "POST", headers: { Authorization: `Bearer ${ghToken}` } },
					);
					if (!res.ok) throw new Error(`GitHub API ${res.status}`);
					const data = (await res.json()) as { token: string };
					const client = new RunnerCtlClient();
					await client.connect();
					try {
						await client.request({
							type: "provision",
							requestId: crypto.randomUUID(),
							name: input.name,
							repo: input.repo,
							registrationToken: data.token,
							callbackUrl: `http://host.containers.internal:3000/api/runners/${input.runnerId}/callback`,
							callbackToken: "test-callback-token",
							label: "noron",
						});
					} finally {
						client.close();
					}
				});
				await step.run({ name: "simulate-callback" }, async () => {
					updateRunnerStatus(input.runnerId, "online");
				});
				const finalStatus = await step.run({ name: "verify-registration" }, async () => {
					const row = db.query("SELECT status FROM runners WHERE id = ?").get(input.runnerId) as {
						status: string;
					} | null;
					if (!row) throw new Error("Runner deleted");
					if (row.status === "online") return "online" as const;
					throw new Error("Not online");
				});
				return { status: finalStatus };
			} catch (err) {
				try {
					updateRunnerStatus(input.runnerId, "failed");
				} catch {
					/* */
				}
				return {
					status: "failed" as const,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		});

		const worker = ow.newWorker({ concurrency: 1 });
		await worker.start();
		const result = await (
			await workflow.run({
				runnerId: "runner-1",
				name: "test-runner",
				repo: "owner/repo",
				userId: "user-1",
			})
		).result({ timeoutMs: 10000 });
		await worker.stop();

		expect(result.status).toBe("online");
		expect(getRunnerStatus("runner-1")).toBe("online");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(requestSpy).toHaveBeenCalledTimes(1);

		fetchSpy.mockRestore();
		connectSpy.mockRestore();
		requestSpy.mockRestore();
		closeSpy.mockRestore();
	});

	test("marks runner failed on GitHub API 401", async () => {
		await seedUser("user-1", "ghp_bad");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");

		const fetchSpy = spyOn(global, "fetch").mockResolvedValueOnce(
			new Response('{"message":"Bad credentials"}', { status: 401 }),
		);

		const workflow = ow.defineWorkflow<
			{ runnerId: string; name: string; repo: string; userId: string },
			{ status: "online" | "failed"; error?: string }
		>({ name: "test-provision-fail" }, async ({ input, step }) => {
			try {
				await step.run({ name: "mark-provisioning" }, async () => {
					updateRunnerStatus(input.runnerId, "provisioning");
				});
				await step.run({ name: "provision-container" }, async () => {
					const ghToken = await getGithubToken(input.userId);
					if (!ghToken) throw new Error("No token");
					const res = await fetch(
						`https://api.github.com/repos/${input.repo}/actions/runners/registration-token`,
						{ method: "POST", headers: { Authorization: `Bearer ${ghToken}` } },
					);
					if (!res.ok) {
						const body = await res.text();
						throw new Error(`GitHub API ${res.status}: ${body}`);
					}
				});
				return { status: "online" as const };
			} catch (err) {
				try {
					updateRunnerStatus(input.runnerId, "failed");
				} catch {
					/* */
				}
				return {
					status: "failed" as const,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		});

		const worker = ow.newWorker({ concurrency: 1 });
		await worker.start();
		const result = await (
			await workflow.run({
				runnerId: "runner-1",
				name: "test-runner",
				repo: "owner/repo",
				userId: "user-1",
			})
		).result({ timeoutMs: 10000 });
		await worker.stop();

		expect(result.status).toBe("failed");
		expect(result.error).toContain("401");
		expect(getRunnerStatus("runner-1")).toBe("failed");

		fetchSpy.mockRestore();
	});

	test("marks runner failed when no GitHub token", async () => {
		await seedUser("user-1", null);
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");

		const workflow = ow.defineWorkflow<
			{ runnerId: string; name: string; repo: string; userId: string },
			{ status: "online" | "failed"; error?: string }
		>({ name: "test-provision-no-token" }, async ({ input, step }) => {
			try {
				await step.run({ name: "mark-provisioning" }, async () => {
					updateRunnerStatus(input.runnerId, "provisioning");
				});
				await step.run({ name: "provision-container" }, async () => {
					const ghToken = await getGithubToken(input.userId);
					if (!ghToken) throw new Error("GitHub token not found for user — re-authenticate");
				});
				return { status: "online" as const };
			} catch (err) {
				try {
					updateRunnerStatus(input.runnerId, "failed");
				} catch {
					/* */
				}
				return {
					status: "failed" as const,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		});

		const worker = ow.newWorker({ concurrency: 1 });
		await worker.start();
		const result = await (
			await workflow.run({
				runnerId: "runner-1",
				name: "test-runner",
				repo: "owner/repo",
				userId: "user-1",
			})
		).result({ timeoutMs: 10000 });
		await worker.stop();

		expect(result.status).toBe("failed");
		expect(result.error).toContain("re-authenticate");
		expect(getRunnerStatus("runner-1")).toBe("failed");
	});

	test("marks runner failed when runner-ctld returns error", async () => {
		await seedUser("user-1", "ghp_test_token");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");

		const fetchSpy = spyOn(global, "fetch").mockResolvedValueOnce(
			Response.json({ token: "AABCDEF123" }),
		);

		const connectSpy = spyOn(RunnerCtlClient.prototype, "connect").mockResolvedValue();
		const requestSpy = spyOn(RunnerCtlClient.prototype, "request").mockRejectedValue(
			new Error("podman: image not found"),
		);
		const closeSpy = spyOn(RunnerCtlClient.prototype, "close").mockImplementation(() => {});

		const workflow = ow.defineWorkflow<
			{ runnerId: string; name: string; repo: string; userId: string },
			{ status: "online" | "failed"; error?: string }
		>({ name: "test-provision-ipc-fail" }, async ({ input, step }) => {
			try {
				await step.run({ name: "mark-provisioning" }, async () => {
					updateRunnerStatus(input.runnerId, "provisioning");
				});
				await step.run({ name: "provision-container" }, async () => {
					const ghToken = await getGithubToken(input.userId);
					if (!ghToken) throw new Error("No token");
					const res = await fetch(
						`https://api.github.com/repos/${input.repo}/actions/runners/registration-token`,
						{ method: "POST", headers: { Authorization: `Bearer ${ghToken}` } },
					);
					if (!res.ok) throw new Error(`GitHub API ${res.status}`);
					const data = (await res.json()) as { token: string };
					const client = new RunnerCtlClient();
					await client.connect();
					try {
						await client.request({
							type: "provision",
							requestId: crypto.randomUUID(),
							name: input.name,
							repo: input.repo,
							registrationToken: data.token,
							callbackUrl: `http://host.containers.internal:3000/api/runners/${input.runnerId}/callback`,
							callbackToken: "test-callback-token",
							label: "noron",
						});
					} finally {
						client.close();
					}
				});
				return { status: "online" as const };
			} catch (err) {
				try {
					updateRunnerStatus(input.runnerId, "failed");
				} catch {
					/* */
				}
				return {
					status: "failed" as const,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		});

		const worker = ow.newWorker({ concurrency: 1 });
		await worker.start();
		const result = await (
			await workflow.run({
				runnerId: "runner-1",
				name: "test-runner",
				repo: "owner/repo",
				userId: "user-1",
			})
		).result({ timeoutMs: 10000 });
		await worker.stop();

		expect(result.status).toBe("failed");
		expect(result.error).toContain("podman: image not found");
		expect(getRunnerStatus("runner-1")).toBe("failed");

		fetchSpy.mockRestore();
		connectSpy.mockRestore();
		requestSpy.mockRestore();
		closeSpy.mockRestore();
	});
});

describe("Deprovision Runner Workflow", () => {
	test("removes runner record on success", async () => {
		await seedUser("user-1", "ghp_test_token");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");
		updateRunnerStatus("runner-1", "online");

		const fetchSpy = spyOn(global, "fetch").mockResolvedValueOnce(Response.json({ runners: [] }));

		const connectSpy = spyOn(RunnerCtlClient.prototype, "connect").mockResolvedValue();
		const requestSpy = spyOn(RunnerCtlClient.prototype, "request").mockResolvedValue({
			requestId: "mock",
			type: "deprovisioned",
			container: "bench-test-runner",
		});
		const closeSpy = spyOn(RunnerCtlClient.prototype, "close").mockImplementation(() => {});

		const workflow = ow.defineWorkflow<
			{ runnerId: string; name: string; repo: string; userId: string },
			{ status: "removed" | "failed"; error?: string }
		>({ name: "test-deprovision" }, async ({ input, step }) => {
			try {
				await step.run({ name: "mark-removing" }, async () => {
					updateRunnerStatus(input.runnerId, "removing");
				});
				await step.run({ name: "stop-container" }, async () => {
					const client = new RunnerCtlClient();
					await client.connect();
					try {
						await client.request({
							type: "deprovision",
							requestId: crypto.randomUUID(),
							name: input.name,
						});
					} finally {
						client.close();
					}
				});
				await step.run({ name: "remove-from-github" }, async () => {
					const ghToken = await getGithubToken(input.userId);
					if (!ghToken) return;
					const res = await fetch(`https://api.github.com/repos/${input.repo}/actions/runners`, {
						headers: { Authorization: `Bearer ${ghToken}` },
					});
					if (!res.ok) return;
					const data = (await res.json()) as { runners: Array<{ id: number; name: string }> };
					const runner = data.runners?.find((r) => r.name === input.name);
					if (!runner) return;
				});
				await step.run({ name: "delete-db-record" }, async () => {
					deleteRunner(input.runnerId);
				});
				return { status: "removed" as const };
			} catch (err) {
				try {
					updateRunnerStatus(input.runnerId, "failed");
				} catch {
					/* */
				}
				return {
					status: "failed" as const,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		});

		const worker = ow.newWorker({ concurrency: 1 });
		await worker.start();
		const result = await (
			await workflow.run({
				runnerId: "runner-1",
				name: "test-runner",
				repo: "owner/repo",
				userId: "user-1",
			})
		).result({ timeoutMs: 10000 });
		await worker.stop();

		expect(result.status).toBe("removed");
		expect(getRunnerStatus("runner-1")).toBeNull();

		fetchSpy.mockRestore();
		connectSpy.mockRestore();
		requestSpy.mockRestore();
		closeSpy.mockRestore();
	});
});

describe("Gate Integration", () => {
	test("workflow step blocks when gate is locked and resumes when opened", async () => {
		const gate = new BenchGate();
		setGate(gate);
		await gate.closeGate();

		let stepRan = false;
		const workflow = ow.defineWorkflow<void, { done: boolean }>(
			{ name: "test-gated" },
			async ({ step }) => {
				await step.run({ name: "gated-step" }, () =>
					withGate(async () => {
						stepRan = true;
					}),
				);
				return { done: true };
			},
		);

		const worker = ow.newWorker({ concurrency: 1 });
		await worker.start();
		const handle = await workflow.run();

		await new Promise((r) => setTimeout(r, 200));
		expect(stepRan).toBe(false); // blocked

		gate.openGate();
		const result = await handle.result({ timeoutMs: 5000 });
		expect(stepRan).toBe(true); // resumed
		expect(result.done).toBe(true);

		await worker.stop();
	});
});

describe("Idempotency", () => {
	test("repeated status updates produce same result", async () => {
		await seedUser("user-1", "ghp_test");
		seedRunner("runner-1", "test-runner", "owner/repo", "user-1");
		for (let i = 0; i < 5; i++) updateRunnerStatus("runner-1", "provisioning");
		expect(getRunnerStatus("runner-1")).toBe("provisioning");
		for (let i = 0; i < 5; i++) updateRunnerStatus("runner-1", "online");
		expect(getRunnerStatus("runner-1")).toBe("online");
	});

	test("step memoization: completed steps return cached results", async () => {
		let callCount = 0;
		const workflow = ow.defineWorkflow<void, { value: number }>(
			{ name: "test-memoization" },
			async ({ step }) => {
				const value = await step.run({ name: "increment" }, async () => {
					callCount++;
					return callCount;
				});
				return { value };
			},
		);

		const worker = ow.newWorker({ concurrency: 1 });
		await worker.start();
		const result = await (await workflow.run()).result({ timeoutMs: 5000 });
		await worker.stop();

		expect(callCount).toBe(1);
		expect(result.value).toBe(1);
	});
});
