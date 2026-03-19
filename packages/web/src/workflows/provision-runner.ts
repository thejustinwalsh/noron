import { DEFAULT_CONFIG, loadConfig } from "@noron/shared";
import {
	getGithubToken,
	getWorkflowDb,
	ow,
	updateRunnerStatus,
	updateRunnerStatusWithMessage,
	withGate,
} from "./index";

export interface ProvisionInput {
	runnerId: string;
	name: string;
	repo: string;
	/** User ID — GitHub token is looked up per-step, never stored in workflow state */
	userId: string;
}

interface ProvisionOutput {
	status: "online";
}

async function requireGithubToken(userId: string): Promise<string> {
	const token = await getGithubToken(userId);
	if (!token) throw new Error("GitHub token not found for user — re-authenticate");
	return token;
}

const provisionRunner = ow.defineWorkflow<ProvisionInput, ProvisionOutput>(
	{
		name: "provision-runner",
		retryPolicy: {
			initialInterval: "2s",
			backoffCoefficient: 2,
			maximumInterval: "60s",
			maximumAttempts: 5,
		},
	},
	async ({ input, step }) => {
		try {
			// Step 1: Update DB status to "provisioning"
			// Idempotent: UPDATE is a no-op if already 'provisioning'
			await step.run({ name: "mark-provisioning" }, async () => {
				updateRunnerStatus(input.runnerId, "provisioning");
			});

			// Step 2: Generate a one-time callback token for secure container → web callback
			const callbackToken = await step.run({ name: "generate-callback-token" }, async () => {
				const token = crypto.randomUUID();
				const db = getWorkflowDb();
				db.run("UPDATE runners SET callback_token = ? WHERE id = ?", [token, input.runnerId]);
				return token;
			});

			// Step 3: Get registration token + start container in one atomic step
			// Combined because: GitHub registration tokens expire in 1 hour,
			// and OpenWorkflow memoizes step results. If we separated these,
			// a crash between them would leave a cached expired token.
			// Idempotent: runner-ctl stops existing container before starting new one
			// Gate blocks inside the step before I/O starts — if a benchmark is
			// running, we wait until it completes before touching containers/GitHub.
			await step.run(
				{
					name: "provision-container",
					retryPolicy: { maximumAttempts: 3, initialInterval: "5s" },
				},
				() =>
					withGate(async (signal) => {
						// Fetch registration token (fresh each attempt)
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

						// Provision container (idempotent — stops existing first)
						const port = process.env.PORT ?? "3000";
						const callbackUrl = `http://localhost:${port}/api/runners/${input.runnerId}/callback`;
						const label = (loadConfig() ?? DEFAULT_CONFIG).runnerLabel;
						// Trim defensively — workflow serialization could introduce whitespace
						const proc = Bun.spawn(
							[
								"sudo",
								"runner-ctl",
								"provision",
								input.name.trim(),
								input.repo.trim(),
								data.token,
								callbackUrl,
								callbackToken,
								label,
							],
							{ stdout: "pipe", stderr: "pipe" },
						);
						const exitCode = await proc.exited;
						if (exitCode !== 0) {
							const stderr = await new Response(proc.stderr).text();
							throw new Error(`runner-ctl provision failed (${exitCode}): ${stderr}`);
						}
					}),
			);

			// Steps 3+: Sleep/check loop — parks the workflow between checks.
			// The container's start.sh curls our callback endpoint after successful
			// registration, which sets status to 'online' in the DB immediately.
			// Each iteration: durable sleep (frees worker) → single DB read.
			// 3 attempts × 60s = 3 min total timeout, 3 wake-ups, zero polling.
			for (let i = 0; i < 3; i++) {
				await step.sleep(`registration-wait-${i}`, "60s");

				const status = await step.run({ name: `check-registration-${i}` }, async () => {
					const db = getWorkflowDb();
					const row = db.query("SELECT status FROM runners WHERE id = ?").get(input.runnerId) as {
						status: string;
					} | null;
					if (!row) return "deleted" as const;
					return row.status as "online" | "provisioning" | "failed";
				});

				if (status === "online") return { status: "online" as const };
				if (status === "deleted") throw new Error("Runner record deleted during provisioning");
				if (status === "failed") throw new Error("Runner reported failure during registration");
			}

			// Exhausted all attempts — registration never completed
			updateRunnerStatusWithMessage(
				input.runnerId,
				"failed",
				"Runner did not register within 3 minutes",
			);
			throw new Error("Runner did not register within 3 minutes");
		} catch (err) {
			// Mark runner as failed so the dashboard shows the error state
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

/** Start a provisioning workflow. Returns the workflow run ID.
 *  Idempotent: calling twice with the same runnerId reuses the existing run. */
export async function startProvisionWorkflow(input: ProvisionInput): Promise<string> {
	const handle = await provisionRunner.run(input, {
		idempotencyKey: `provision:${input.repo}`,
	});
	return handle.workflowRun.id;
}
