import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { extractToken, getUserByToken } from "../auth-middleware";
import { backend } from "../workflows";

interface WorkflowInput {
	userId?: string;
	runnerId?: string;
	name?: string;
	repo?: string;
}

function getInputUserId(input: unknown): string | null {
	if (input && typeof input === "object" && "userId" in input) {
		return (input as WorkflowInput).userId ?? null;
	}
	return null;
}

export function workflowRoutes(db: Database): Hono {
	const app = new Hono();

	// Workflow counts — admin sees all, non-admin sees own
	app.get("/workflows/counts", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		if (user.role === "admin") {
			const counts = await backend.countWorkflowRuns();
			return c.json(counts);
		}

		// Non-admin: fetch all runs and count by ownership
		const all = await backend.listWorkflowRuns({ limit: 500 });
		const owned = all.data.filter((r) => getInputUserId(r.input) === user.id);
		const counts = {
			pending: 0,
			running: 0,
			sleeping: 0,
			completed: 0,
			failed: 0,
			canceled: 0,
		};
		for (const run of owned) {
			const status = run.status as keyof typeof counts;
			if (status in counts) counts[status]++;
		}
		return c.json(counts);
	});

	// List workflow runs — filtered by status and ownership
	app.get("/workflows", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const statusFilter = c.req.query("status");
		const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

		const result = await backend.listWorkflowRuns({ limit: user.role === "admin" ? limit : 500 });
		let runs = result.data;

		// Scope to user's own workflows for non-admins
		if (user.role !== "admin") {
			runs = runs.filter((r) => getInputUserId(r.input) === user.id);
		}

		// Post-filter by status
		if (statusFilter) {
			runs = runs.filter((r) => r.status === statusFilter);
		}

		// Trim to requested limit (for non-admin we fetched more for filtering)
		if (runs.length > limit) {
			runs = runs.slice(0, limit);
		}

		return c.json({ data: runs });
	});

	// Get single workflow run
	app.get("/workflows/:id", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const run = await backend.getWorkflowRun({ workflowRunId: c.req.param("id") });
		if (!run) return c.json({ error: "Not found" }, 404);

		// Ownership check for non-admins
		if (user.role !== "admin" && getInputUserId(run.input) !== user.id) {
			return c.json({ error: "Not found" }, 404);
		}

		return c.json(run);
	});

	// List step attempts for a workflow run
	app.get("/workflows/:id/steps", async (c) => {
		const token = extractToken(c.req.header("Cookie"), c.req.header("Authorization"));
		if (!token) return c.json({ error: "Unauthorized" }, 401);

		const user = getUserByToken(db, token);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		const workflowRunId = c.req.param("id");

		// Verify ownership
		const run = await backend.getWorkflowRun({ workflowRunId });
		if (!run) return c.json({ error: "Not found" }, 404);
		if (user.role !== "admin" && getInputUserId(run.input) !== user.id) {
			return c.json({ error: "Not found" }, 404);
		}

		const result = await backend.listStepAttempts({ workflowRunId });
		return c.json({ data: result.data });
	});

	return app;
}
