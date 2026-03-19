import { Database as SqliteDatabase } from "bun:sqlite";
import type { Database } from "bun:sqlite";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import type { BenchGate } from "../bench-gate";
import { decryptToken } from "../crypto";

const workflowDbPath = process.env.WORKFLOW_DB_PATH ?? "./workflows.db";
export const backend = BackendSqlite.connect(workflowDbPath);

export const ow = new OpenWorkflow({ backend });

/** Shared DB reference — set once from main.ts */
let _db: Database;

export function setWorkflowDb(db: Database): void {
	_db = db;
}

export function getWorkflowDb(): Database {
	if (!_db) throw new Error("Workflow DB not initialized — call setWorkflowDb first");
	return _db;
}

/** Shared gate reference — set once from main.ts */
let _gate: BenchGate;

export function setGate(gate: BenchGate): void {
	_gate = gate;
}

export function getGate(): BenchGate {
	if (!_gate) throw new Error("Gate not initialized — call setGate first");
	return _gate;
}

/** Run a function while holding a gate pass. Ensures exit() is always called. */
export async function withGate<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const pass = await getGate().enterGate();
	try {
		return await fn(pass.signal);
	} finally {
		pass.exit();
	}
}

/** Look up a user's effective GitHub token from the app DB.
 *  Prefers fine-grained PAT over OAuth token. Returns null if neither found.
 *  Decrypts the token from its encrypted-at-rest form. */
export async function getGithubToken(userId: string): Promise<string | null> {
	const db = getWorkflowDb();
	const row = db.query("SELECT github_token, github_pat FROM users WHERE id = ?").get(userId) as {
		github_token: string | null;
		github_pat: string | null;
	} | null;
	if (!row) return null;
	const pat = await decryptToken(row.github_pat);
	if (pat) return pat;
	return await decryptToken(row.github_token);
}

/** Update a runner's status in the app DB. */
export function updateRunnerStatus(runnerId: string, status: string): void {
	const db = getWorkflowDb();
	db.run("UPDATE runners SET status = ? WHERE id = ?", [status, runnerId]);
}

/** Update a runner's status and human-readable error message in the app DB. */
export function updateRunnerStatusWithMessage(
	runnerId: string,
	status: string,
	message: string,
): void {
	const db = getWorkflowDb();
	db.run("UPDATE runners SET status = ?, status_message = ? WHERE id = ?", [
		status,
		message,
		runnerId,
	]);
}

/** Delete a runner record from the app DB. */
export function deleteRunner(runnerId: string): void {
	const db = getWorkflowDb();
	db.run("DELETE FROM runners WHERE id = ?", [runnerId]);
}

const MAX_WORKFLOW_RUNS = 100;

/** Keep only the newest MAX_WORKFLOW_RUNS finished workflow runs.
 *  Active runs (pending/running/sleeping) are never deleted.
 *  Step attempts are cascade-deleted by the FK constraint. */
export function purgeOldWorkflowRuns(): number {
	const wfDb = new SqliteDatabase(workflowDbPath);
	try {
		const result = wfDb.run(
			`DELETE FROM workflow_runs
			 WHERE status IN ('completed', 'failed', 'canceled')
			   AND id NOT IN (
			     SELECT id FROM workflow_runs
			     ORDER BY created_at DESC
			     LIMIT ?
			   )`,
			[MAX_WORKFLOW_RUNS],
		);
		return result.changes;
	} finally {
		wfDb.close();
	}
}
