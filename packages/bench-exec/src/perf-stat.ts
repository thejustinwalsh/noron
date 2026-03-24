/**
 * Parser for `perf stat -x \t` (tab-separated) output.
 *
 * perf stat -x \t format (one counter per line):
 *   <value>\t<unit>\t<event-name>\t<counter-runtime>\t<pct-of-measurement>\t[extra]
 *
 * Lines starting with '#' are comments. Empty lines are skipped.
 */

export interface PerfStatCounter {
	value: number;
	unit: string;
	event: string;
}

export interface PerfStatResult {
	counters: Record<string, PerfStatCounter>;
	// Derived convenience fields
	ipc: number | null;
	contextSwitches: number;
	cpuMigrations: number;
	branchMissRate: number | null;
	l1MissRate: number | null;
	isolationHealthy: boolean;
}

/**
 * Parse perf stat tab-separated output into structured data.
 * Handles both file content (from -o) and raw stderr output.
 */
export function parsePerfStat(raw: string): PerfStatResult {
	const counters: Record<string, PerfStatCounter> = {};

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		// perf stat -x \t fields: value, unit, event, runtime, pct, [extra...]
		const fields = trimmed.split("\t");
		if (fields.length < 3) continue;

		const valueStr = fields[0].replace(/,/g, "");
		const value = Number.parseFloat(valueStr);
		if (Number.isNaN(value)) continue;

		const unit = fields[1] ?? "";
		const event = fields[2] ?? "";
		if (!event) continue;

		counters[event] = { value, unit, event };
	}

	const get = (name: string): number | undefined => counters[name]?.value;

	const cycles = get("cycles");
	const instructions = get("instructions");
	const ipc = cycles && instructions ? instructions / cycles : null;

	const branches = get("branches");
	const branchMisses = get("branch-misses");
	const branchMissRate = branches && branchMisses != null ? (branchMisses / branches) * 100 : null;

	const l1Loads = get("L1-dcache-loads");
	const l1Misses = get("L1-dcache-load-misses");
	const l1MissRate = l1Loads && l1Misses != null ? (l1Misses / l1Loads) * 100 : null;

	const contextSwitches = get("context-switches") ?? 0;
	const cpuMigrations = get("cpu-migrations") ?? 0;

	return {
		counters,
		ipc,
		contextSwitches,
		cpuMigrations,
		branchMissRate,
		l1MissRate,
		isolationHealthy: cpuMigrations === 0,
	};
}

/** Check if perf is available on this system. */
export function isPerfAvailable(): boolean {
	try {
		const result = Bun.spawnSync(["perf", "version"]);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

/** Format a PerfStatResult as a human-readable summary string. */
export function formatPerfStatSummary(result: PerfStatResult): string {
	const lines: string[] = [];

	const fmt = (n: number): string => {
		if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
		return String(Math.round(n));
	};

	lines.push(
		`Isolation: ${result.isolationHealthy ? "HEALTHY" : "WARNING"}` +
			`  (ctx-switches: ${result.contextSwitches}, cpu-migrations: ${result.cpuMigrations})`,
	);

	if (result.ipc != null) {
		lines.push(`IPC: ${result.ipc.toFixed(2)} instructions/cycle`);
	}

	const cycles = result.counters.cycles?.value;
	const instructions = result.counters.instructions?.value;
	if (cycles != null) lines.push(`Cycles: ${fmt(cycles)}`);
	if (instructions != null) lines.push(`Instructions: ${fmt(instructions)}`);

	if (result.branchMissRate != null) {
		lines.push(`Branch miss rate: ${result.branchMissRate.toFixed(2)}%`);
	}

	if (result.l1MissRate != null) {
		lines.push(`L1 dcache miss rate: ${result.l1MissRate.toFixed(2)}%`);
	}

	const pageFaults = result.counters["page-faults"]?.value;
	if (pageFaults != null) lines.push(`Page faults: ${fmt(pageFaults)}`);

	const taskClock = result.counters["task-clock"]?.value;
	if (taskClock != null) lines.push(`Task clock: ${taskClock.toFixed(2)} ms`);

	return lines.join("\n");
}
