#!/usr/bin/env bun
/**
 * GitHub Actions Runner Hook: ACTIONS_RUNNER_HOOK_JOB_COMPLETED
 * Releases the machine-wide lock after all job steps complete.
 * Reports violations (action not used) to bench-web for strike tracking.
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { BenchdClient, JOB_TOKEN_PATH } from "@noron/shared";

const client = new BenchdClient();
await client.connect();

const jobId = process.env.GITHUB_JOB ?? "unknown";
const runId = process.env.GITHUB_RUN_ID ?? "unknown";
const owner = process.env.GITHUB_REPOSITORY ?? "unknown";
const jobStatus = process.env.GITHUB_JOB_STATUS ?? "";

// Read the job token written by job-started
let jobToken = "";
try {
	jobToken = readFileSync(JOB_TOKEN_PATH, "utf-8").trim();
} catch {
	console.error("[noron] Warning: could not read job token file");
}

console.log(`[noron] Releasing machine lock for job ${jobId}...`);

const response = await client.request({
	type: "lock.release",
	requestId: crypto.randomUUID(),
	jobToken,
	jobId,
});

if (response.type === "lock.released") {
	console.log("[noron] Lock released");

	// Violations are now broadcast via IPC to bench-web subscribers automatically.
	// The hook no longer needs to report them over HTTP.
	if (response.violation && jobStatus !== "cancelled" && jobStatus !== "skipped") {
		console.warn(`[noron] Violation: ${response.violation}`);
	}
} else {
	console.error(`[noron] Unexpected response: ${JSON.stringify(response)}`);
	// Don't exit with error — the job is already complete
}

// Clean up the token file
try {
	if (existsSync(JOB_TOKEN_PATH)) unlinkSync(JOB_TOKEN_PATH);
} catch {}

client.close();
