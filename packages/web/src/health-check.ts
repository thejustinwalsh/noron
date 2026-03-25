import type { Database } from "bun:sqlite";
import { BenchdClient, RunnerCtlClient, SOCKET_PATH } from "@noron/shared";
import { startHealWorkflow } from "./workflows/heal-runner";

interface ActiveRunner {
	id: string;
	name: string;
	repo: string;
	owner_id: string;
	status: string;
}

interface RunnerCtlStatus {
	status: "running" | "not_found" | "stopped" | "stale";
	state?: string;
}

/** Check benchd socket is alive — if not, containers have stale mounts. */
async function isBenchdHealthy(): Promise<boolean> {
	try {
		const client = new BenchdClient(process.env.BENCHD_SOCKET ?? SOCKET_PATH);
		await client.connect();
		const res = await client.request({
			type: "config.get",
			requestId: crypto.randomUUID(),
		});
		client.close();
		return res.type === "config.get";
	} catch {
		return false;
	}
}

/** Check all active runners once and trigger heal workflows for dead ones.
 *  Returns the number of runners checked. */
export async function checkRunners(db: Database): Promise<number> {
	const runners = db
		.query("SELECT id, name, repo, owner_id, status FROM runners WHERE status = 'online'")
		.all() as ActiveRunner[];

	if (runners.length === 0) return 0;

	// If benchd is unreachable, all containers have stale socket mounts —
	// heal them all so they get fresh bind mounts on reprovision.
	const benchdUp = await isBenchdHealthy();
	if (!benchdUp) {
		console.log("[health-check] benchd is unreachable — marking all runners offline for heal");
		for (const runner of runners) {
			markOfflineAndHeal(db, runner, "benchd socket unreachable");
		}
		return runners.length;
	}

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
				db.run("UPDATE runners SET last_heartbeat = ? WHERE id = ? AND status = 'online'", [
					Date.now(),
					runner.id,
				]);
			} else if (result.status === "stale") {
				// Container running but benchd socket stale — needs reprovision
				markOfflineAndHeal(db, runner, "benchd socket stale inside container");
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

function markOfflineAndHeal(db: Database, runner: ActiveRunner, reason?: string) {
	// WHERE guard prevents race with provisioning — only update if still online/busy
	const message = reason ?? "Container stopped unexpectedly";
	const result = db.run(
		"UPDATE runners SET status = 'offline', status_message = ? WHERE id = ? AND status = 'online'",
		[message, runner.id],
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
