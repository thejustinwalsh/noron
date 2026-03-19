#!/usr/bin/env bun
/**
 * GitHub Actions Runner Hook: ACTIONS_RUNNER_HOOK_JOB_STARTED
 * Acquires the machine-wide lock before any job step runs.
 * This blocks until the lock is granted (FIFO queue).
 * Writes the job token to a file for the noron action to read.
 */
import { chmodSync, writeFileSync } from "node:fs";
import { BenchdClient, JOB_TOKEN_PATH } from "@noron/shared";

const client = new BenchdClient();
await client.connect();

const jobId = process.env.GITHUB_JOB ?? "unknown";
const runId = process.env.GITHUB_RUN_ID ?? "unknown";
const owner = process.env.GITHUB_REPOSITORY ?? "unknown";

console.log(`[noron] Acquiring machine lock for job ${jobId} (${owner})...`);

const response = await client.request({
	type: "lock.acquire",
	requestId: crypto.randomUUID(),
	jobId,
	runId,
	owner,
});

if (response.type === "lock.acquired") {
	console.log(`[noron] Lock acquired (position: ${response.position})`);

	// Write the job token for the noron action and job-completed hook to read
	try {
		writeFileSync(JOB_TOKEN_PATH, response.jobToken, { mode: 0o600 });
	} catch (err) {
		console.error(`[noron] Warning: could not write job token file: ${err}`);
	}
} else {
	console.error(`[noron] Unexpected response: ${JSON.stringify(response)}`);
	process.exit(1);
}

client.close();
