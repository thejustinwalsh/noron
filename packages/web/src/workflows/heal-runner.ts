import { DEFAULT_CONFIG, RunnerCtlClient, loadConfig } from "@noron/shared";
import {
	getGithubToken,
	getWorkflowDb,
	ow,
	updateRunnerStatusWithMessage,
	withGate,
} from "./index";

export interface HealInput {
	runnerId: string;
	name: string;
	repo: string;
	/** User ID — GitHub token is looked up per-step, never stored in workflow state */
	userId: string;
}

interface HealOutput {
	status: "online";
}

async function requireGithubToken(userId: string): Promise<string> {
	const token = await getGithubToken(userId);
	if (!token) throw new Error("GitHub token not found for user — re-authenticate");
	return token;
}

const healRunner = ow.defineWorkflow<HealInput, HealOutput>(
	{
		name: "heal-runner",
		retryPolicy: {
			initialInterval: "2s",
			backoffCoefficient: 2,
			maximumInterval: "60s",
			maximumAttempts: 5,
		},
	},
	async ({ input, step }) => {
		try {
			// Step 1: Mark as healing in DB
			await step.run({ name: "mark-healing" }, async () => {
				const db = getWorkflowDb();
				db.run("UPDATE runners SET status = 'healing', status_message = NULL WHERE id = ?", [
					input.runnerId,
				]);
			});

			// Step 2: Generate a one-time callback token for secure container → web callback
			const callbackToken = await step.run({ name: "generate-callback-token" }, async () => {
				const token = crypto.randomUUID();
				const db = getWorkflowDb();
				db.run("UPDATE runners SET callback_token = ? WHERE id = ?", [token, input.runnerId]);
				return token;
			});

			// Step 3: Get registration token + start container
			// Gate blocks inside the step before I/O starts.
			await step.run(
				{
					name: "provision-container",
					retryPolicy: { maximumAttempts: 3, initialInterval: "5s" },
				},
				() =>
					withGate(async (signal) => {
						const ghToken = await requireGithubToken(input.userId);
						const res = await fetch(
							`https://api.github.com/repos/${input.repo}/actions/runners/registration-token`,
							{
								method: "POST",
								headers: {
									Authorization: `Bearer ${ghToken}`,
									Accept: "application/vnd.github+json",
								},
								signal,
							},
						);
						if (!res.ok) {
							const body = await res.text();
							throw new Error(`GitHub API ${res.status}: ${body}`);
						}
						const data = (await res.json()) as { token: string };

						const port = process.env.PORT ?? "9216";
						const callbackUrl = `http://host.containers.internal:${port}/api/runners/${input.runnerId}/callback`;
						const label = (loadConfig() ?? DEFAULT_CONFIG).runnerLabel;
						const client = new RunnerCtlClient();
						await client.connect();
						try {
							await client.request({
								type: "provision",
								requestId: crypto.randomUUID(),
								name: input.name.trim(),
								repo: input.repo.trim(),
								registrationToken: data.token,
								callbackUrl,
								callbackToken,
								label,
							});
						} finally {
							client.close();
						}
					}),
			);

			// Step 5: Sleep/check loop for registration
			for (let i = 0; i < 3; i++) {
				await step.sleep(`registration-wait-${i}`, "60s");

				const status = await step.run({ name: `check-registration-${i}` }, async () => {
					const db = getWorkflowDb();
					const row = db.query("SELECT status FROM runners WHERE id = ?").get(input.runnerId) as {
						status: string;
					} | null;
					if (!row) return "deleted" as const;
					return row.status as "online" | "healing" | "failed";
				});

				if (status === "online") return { status: "online" as const };
				if (status === "deleted") throw new Error("Runner record deleted during healing");
				if (status === "failed") throw new Error("Runner reported failure during registration");
			}

			updateRunnerStatusWithMessage(
				input.runnerId,
				"failed",
				"Runner did not re-register within 3 minutes after heal",
			);
			throw new Error("Runner did not re-register within 3 minutes after heal");
		} catch (err) {
			// Re-throw workflow control signals without marking as failed
			if (err instanceof Error && err.name === "SleepSignal") throw err;

			const message = err instanceof Error ? err.message : String(err);
			try {
				updateRunnerStatusWithMessage(input.runnerId, "failed", message);
			} catch {
				// DB update itself failed — nothing we can do
			}
			// Re-throw so OpenWorkflow marks the workflow run as failed
			throw err;
		}
	},
);

/** Start a heal workflow. Returns the workflow run ID.
 *  Idempotent: calling twice with the same runnerId reuses the existing run. */
export async function startHealWorkflow(input: HealInput): Promise<string> {
	const handle = await healRunner.run(input, {
		idempotencyKey: `heal:${input.runnerId}`,
	});
	return handle.workflowRun.id;
}
