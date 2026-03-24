import type { Database } from "bun:sqlite";
import { RunnerCtlClient } from "@noron/shared";
import { startHealWorkflow } from "./workflows/heal-runner";

interface ActiveRunner {
	id: string;
	name: string;
	repo: string;
	owner_id: string;
	status: string;
}

interface RunnerCtlStatus {
	status: "running" | "not_found" | "stopped";
	state?: string;
}

/** Check all active runners once and trigger heal workflows for dead ones.
 *  Returns the number of runners checked. */
export async function checkRunners(db: Database): Promise<number> {
	const runners = db
		.query(
			"SELECT id, name, repo, owner_id, status FROM runners WHERE status IN ('online', 'busy')",
		)
		.all() as ActiveRunner[];

	for (const runner of runners) {
		try {
			const client = new RunnerCtlClient();
			await client.connect();
			let result: RunnerCtlStatus;
			try {
				const response = await client.request({
					type: "status",
					requestId: crypto.randomUUID(),
					name: runner.name,
				});
				result = { status: response.state as RunnerCtlStatus["status"] };
			} catch {
				// Connection or command failed — treat as not running
				markOfflineAndHeal(db, runner);
				continue;
			} finally {
				client.close();
			}

			if (result.status === "running") {
				// Healthy — update heartbeat
				db.run(
					"UPDATE runners SET last_heartbeat = ? WHERE id = ? AND status IN ('online', 'busy')",
					[Date.now(), runner.id],
				);
			} else {
				// Stopped or not found — mark offline and heal
				markOfflineAndHeal(db, runner);
			}
		} catch (err) {
			console.error(`[health-check] Error checking runner ${runner.name}:`, err);
		}
	}

	return runners.length;
}

function markOfflineAndHeal(db: Database, runner: ActiveRunner) {
	// WHERE guard prevents race with provisioning — only update if still online/busy
	const result = db.run(
		"UPDATE runners SET status = 'offline', status_message = 'Container stopped unexpectedly' WHERE id = ? AND status IN ('online', 'busy')",
		[runner.id],
	);

	if (result.changes > 0) {
		console.log(`[health-check] Runner ${runner.name} is offline — triggering heal workflow`);
		startHealWorkflow({
			runnerId: runner.id,
			name: runner.name,
			repo: runner.repo,
			userId: runner.owner_id,
		}).catch((err) => {
			console.error(`[health-check] Failed to start heal workflow for ${runner.name}:`, err);
		});
	}
}
