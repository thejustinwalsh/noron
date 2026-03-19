import { BenchdClient, SOCKET_PATH } from "@noron/shared";
import { getWorkflowDb, ow, withGate } from "./index";

export interface SelfUpdateInput {
	updateId: string;
	version: string;
	downloadUrl: string;
	expectedSize: number;
}

interface SelfUpdateOutput {
	status: "completed" | "rolled_back";
}

const UPDATES_DIR = "/var/lib/bench/updates";
const VERSION_FILE = "/var/lib/bench/version";

function updateState(updateId: string, state: string, error?: string) {
	const db = getWorkflowDb();
	if (error) {
		db.run("UPDATE updates SET state = ?, error = ? WHERE id = ?", [state, error, updateId]);
	} else {
		db.run("UPDATE updates SET state = ? WHERE id = ?", [state, updateId]);
	}
}

async function runCmd(args: string[]): Promise<{ ok: boolean; output: string }> {
	const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { ok: exitCode === 0, output: stdout + stderr };
}

const selfUpdate = ow.defineWorkflow<SelfUpdateInput, SelfUpdateOutput>(
	{
		name: "self-update",
		retryPolicy: {
			initialInterval: "5s",
			backoffCoefficient: 2,
			maximumInterval: "60s",
			maximumAttempts: 3,
		},
	},
	async ({ input, step }) => {
		const updateDir = `${UPDATES_DIR}/${input.version}`;

		// Step 1: Mark update as downloading
		await step.run({ name: "mark-downloading" }, async () => {
			updateState(input.updateId, "downloading");
		});

		// Step 2: Download update archive (gate-aware — pauses if benchmark starts)
		await step.run(
			{
				name: "download-archive",
				retryPolicy: { maximumAttempts: 3, initialInterval: "10s" },
			},
			() =>
				withGate(async (signal) => {
					const res = await fetch(input.downloadUrl, { signal });
					if (!res.ok) {
						throw new Error(`Download failed: HTTP ${res.status}`);
					}

					const data = await res.arrayBuffer();
					if (input.expectedSize > 0 && data.byteLength !== input.expectedSize) {
						throw new Error(
							`Size mismatch: expected ${input.expectedSize}, got ${data.byteLength}`,
						);
					}

					// Extract archive
					await Bun.write(`${updateDir}.tar.gz`, data);
					const mkdir = await runCmd(["mkdir", "-p", updateDir]);
					if (!mkdir.ok) throw new Error(`mkdir failed: ${mkdir.output}`);

					const extract = await runCmd(["tar", "-xzf", `${updateDir}.tar.gz`, "-C", updateDir]);
					if (!extract.ok) throw new Error(`tar extract failed: ${extract.output}`);

					// Clean up tarball
					await runCmd(["rm", "-f", `${updateDir}.tar.gz`]);
				}),
		);

		// Step 3: Wait for idle — no active benchmark lock
		for (let i = 0; i < 30; i++) {
			const idle = await step.run({ name: `check-idle-${i}` }, async () => {
				try {
					const client = new BenchdClient(process.env.BENCHD_SOCKET ?? SOCKET_PATH);
					await client.connect();
					const status = await client.request({
						type: "lock.status",
						requestId: crypto.randomUUID(),
					});
					client.close();
					return status.type === "lock.status" && !status.held;
				} catch {
					// benchd not reachable — treat as idle (it may be down)
					return true;
				}
			});

			if (idle) break;
			await step.sleep(`idle-wait-${i}`, "60s");
		}

		// Step 4: Backup current installation
		await step.run({ name: "backup-current" }, async () => {
			updateState(input.updateId, "applying");
			const result = await runCmd(["sudo", "bench-updater", "backup"]);
			if (!result.ok) {
				throw new Error(`Backup failed: ${result.output}`);
			}
		});

		// Step 5: Apply update — this restarts bench-web, so workflow state
		// must be persisted before this point. OpenWorkflow handles this via SQLite.
		await step.run({ name: "apply-update" }, async () => {
			const result = await runCmd(["sudo", "bench-updater", "apply", updateDir]);
			if (!result.ok) {
				throw new Error(`Apply failed: ${result.output}`);
			}
			// After this, bench-web restarts and the workflow resumes at step 6
		});

		// Step 6: Verify health (runs after bench-web restarts)
		// Short delay to let services stabilize
		await step.sleep("post-restart-settle", "10s");

		let healthy = false;
		for (let attempt = 0; attempt < 3; attempt++) {
			healthy = await step.run({ name: `verify-health-${attempt}` }, async () => {
				try {
					// Check benchd is reachable
					const client = new BenchdClient(process.env.BENCHD_SOCKET ?? SOCKET_PATH);
					await client.connect();
					const config = await client.request({
						type: "config.get",
						requestId: crypto.randomUUID(),
					});
					client.close();
					if (config.type !== "config.get") return false;

					// Check version file matches expected
					const versionFile = await Bun.file(VERSION_FILE).text();
					if (versionFile.trim() !== input.version) return false;

					return true;
				} catch {
					return false;
				}
			});

			if (healthy) break;
			await step.sleep(`health-retry-${attempt}`, "30s");
		}

		if (!healthy) {
			// Rollback
			await step.run({ name: "rollback" }, async () => {
				console.error(
					`[self-update] Health check failed after update to ${input.version} — rolling back`,
				);
				const result = await runCmd(["sudo", "bench-updater", "rollback"]);
				if (!result.ok) {
					console.error(`[self-update] Rollback failed: ${result.output}`);
				}
			});

			await step.run({ name: "mark-rolled-back" }, async () => {
				updateState(input.updateId, "rolled_back", "Health check failed after update");
			});

			return { status: "rolled_back" as const };
		}

		// Step 7: Rebuild runner container with new assets
		await step.run({ name: "rebuild-runner-image" }, async () => {
			const result = await runCmd([
				"sudo",
				"podman",
				"build",
				"-t",
				"bench-runner",
				"/opt/runner/",
			]);
			if (!result.ok) {
				console.error(`[self-update] Runner image rebuild failed: ${result.output}`);
				// Non-fatal — runners will use old image until next reprovision
			}
		});

		// Reprovision active runners so they pick up the new image
		await step.run({ name: "reprovision-runners" }, async () => {
			const db = getWorkflowDb();
			const runners = db
				.query("SELECT name FROM runners WHERE status IN ('online', 'busy')")
				.all() as { name: string }[];

			for (const runner of runners) {
				// Deprovision then re-provision happens via the existing heal workflow
				// triggered by health-check when the container is stopped
				const result = await runCmd(["sudo", "runner-ctl", "deprovision", runner.name]);
				if (!result.ok) {
					console.error(
						`[self-update] Failed to deprovision runner ${runner.name}: ${result.output}`,
					);
				}
			}
			// Health check will detect offline runners and trigger heal workflows
		});

		// Step 8: Mark complete
		await step.run({ name: "mark-complete" }, async () => {
			const db = getWorkflowDb();
			db.run("UPDATE updates SET state = 'completed', completed_at = ? WHERE id = ?", [
				Date.now(),
				input.updateId,
			]);
			// Clean up download directory
			await runCmd(["rm", "-rf", updateDir]);
		});

		return { status: "completed" as const };
	},
);

export async function startSelfUpdateWorkflow(input: SelfUpdateInput): Promise<string> {
	const handle = await selfUpdate.run(input, {
		idempotencyKey: `update:${input.version}`,
	});
	return handle.workflowRun.id;
}
