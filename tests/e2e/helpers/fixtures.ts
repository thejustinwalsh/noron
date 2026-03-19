import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type BenchdConfig } from "../../../packages/shared/src/config";
import type { CpuTopology } from "../../../packages/shared/src/cpu-topology";

export const testTopology: CpuTopology = {
	totalCores: 4,
	onlineCores: [0, 1, 2, 3],
	recommendedIsolated: [1, 2, 3],
	recommendedHousekeeping: 0,
	thermalZones: [],
};

/** Generate unique temp file paths scoped to this process. */
export function uniquePaths(label: string) {
	const id = `${process.pid}-${label}`;
	return {
		socketPath: join(tmpdir(), `benchd-e2e-${id}.sock`),
		dbPath: join(tmpdir(), `bench-e2e-${id}.db`),
		workflowDbPath: join(tmpdir(), `bench-e2e-wf-${id}.db`),
	};
}

/** Create a BenchdConfig suitable for e2e testing. */
export function makeTestConfig(socketPath: string): BenchdConfig {
	return {
		...DEFAULT_CONFIG,
		socketPath,
		// Fast poll so thermal deadlines are checked quickly
		thermalPollIntervalMs: 100,
	};
}
