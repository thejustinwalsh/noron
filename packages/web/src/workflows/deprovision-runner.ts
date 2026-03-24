import { RunnerCtlClient } from "@noron/shared";
import {
	deleteRunner,
	getGithubToken,
	ow,
	updateRunnerStatus,
	updateRunnerStatusWithMessage,
	withGate,
} from "./index";

export interface DeprovisionInput {
	runnerId: string;
	name: string;
	repo: string;
	/** User ID — GitHub token is looked up per-step, never stored in workflow state */
	userId: string;
}

interface DeprovisionOutput {
	status: "removed";
}

const deprovisionRunner = ow.defineWorkflow<DeprovisionInput, DeprovisionOutput>(
	{
		name: "deprovision-runner",
		retryPolicy: {
			initialInterval: "2s",
			backoffCoefficient: 2,
			maximumInterval: "30s",
			maximumAttempts: 5,
		},
	},
	async ({ input, step }) => {
		try {
			// Step 1: Mark as removing in DB (idempotent — overwrites any current status)
			await step.run({ name: "mark-removing" }, async () => {
				updateRunnerStatus(input.runnerId, "removing");
			});

			// Step 2: Stop and remove container (idempotent — runner-ctl handles already-stopped)
			// Gate blocks inside the step before I/O starts.
			await step.run(
				{
					name: "stop-container",
					retryPolicy: { maximumAttempts: 3, initialInterval: "3s" },
				},
				() =>
					withGate(async () => {
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
					}),
			);

			// Step 3: Remove runner from GitHub (best-effort, idempotent)
			// Each step independently enters/exits the gate — if a benchmark starts
			// between stop-container and this step, the GitHub cleanup waits.
			await step.run({ name: "remove-from-github" }, () =>
				withGate(async (signal) => {
					const ghToken = await getGithubToken(input.userId);
					if (!ghToken) return; // no token — skip GitHub cleanup

					// List runners to find the one by name
					const listRes = await fetch(
						`https://api.github.com/repos/${input.repo}/actions/runners`,
						{
							headers: {
								Authorization: `Bearer ${ghToken}`,
								Accept: "application/vnd.github+json",
							},
							signal,
						},
					);
					if (!listRes.ok) return; // best-effort — container is already stopped

					const data = (await listRes.json()) as {
						runners: Array<{ id: number; name: string }>;
					};
					const runner = data.runners?.find((r) => r.name === input.name);
					if (!runner) return; // already removed — idempotent

					// Delete the runner from GitHub
					await fetch(`https://api.github.com/repos/${input.repo}/actions/runners/${runner.id}`, {
						method: "DELETE",
						headers: {
							Authorization: `Bearer ${ghToken}`,
							Accept: "application/vnd.github+json",
						},
						signal,
					});
				}),
			);

			// Step 4: Delete DB record (idempotent — DELETE WHERE is a no-op if already gone)
			await step.run({ name: "delete-db-record" }, async () => {
				deleteRunner(input.runnerId);
			});

			return { status: "removed" as const };
		} catch (err) {
			// Re-throw workflow control signals without marking as failed
			if (err instanceof Error && err.name === "SleepSignal") throw err;

			// Mark runner as failed so the dashboard shows the error state
			const message = err instanceof Error ? err.message : String(err);
			try {
				updateRunnerStatusWithMessage(input.runnerId, "failed", message);
			} catch {
				// DB update itself failed or record already deleted
			}
			// Re-throw so OpenWorkflow marks the workflow run as failed
			throw err;
		}
	},
);

/** Start a deprovisioning workflow.
 *  Idempotent: calling twice with the same runnerId reuses the existing run. */
export async function startDeprovisionWorkflow(input: DeprovisionInput): Promise<string> {
	const handle = await deprovisionRunner.run(input, {
		idempotencyKey: `deprovision:${input.runnerId}`,
	});
	return handle.workflowRun.id;
}
