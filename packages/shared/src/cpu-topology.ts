import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";

export interface CpuTopology {
	/** Total number of CPU cores detected */
	totalCores: number;
	/** IDs of cores currently online */
	onlineCores: number[];
	/** Recommended cores for benchmark isolation */
	recommendedIsolated: number[];
	/** Recommended core for OS housekeeping */
	recommendedHousekeeping: number;
	/** Detected thermal zone paths */
	thermalZones: ThermalZoneInfo[];
	/** Per-core capacity (0-1024) from sysfs, null if unavailable (x86, macOS) */
	coreCapacities: Map<number, number> | null;
}

export interface ThermalZoneInfo {
	name: string;
	type: string;
	path: string;
}

/**
 * Read online CPU core IDs from sysfs (Linux only).
 * Parses /sys/devices/system/cpu/online which contains ranges like "0-3" or "0-1,3-7".
 */
function readOnlineCoresFromSysfs(): number[] | null {
	const onlinePath = "/sys/devices/system/cpu/online";
	if (!existsSync(onlinePath)) return null;

	try {
		const raw = readFileSync(onlinePath, "utf-8").trim();
		return parseCpuRange(raw);
	} catch {
		return null;
	}
}

/** Parse a CPU range string like "0-3" or "0-1,4-7" into an array of core IDs */
export function parseCpuRange(range: string): number[] {
	const cores: number[] = [];
	for (const part of range.split(",")) {
		const trimmed = part.trim();
		if (trimmed.includes("-")) {
			const [start, end] = trimmed.split("-").map(Number);
			for (let i = start; i <= end; i++) {
				cores.push(i);
			}
		} else {
			const n = Number(trimmed);
			if (!Number.isNaN(n)) cores.push(n);
		}
	}
	return cores.sort((a, b) => a - b);
}

/**
 * Read per-core capacity values from sysfs (Linux ARM big.LITTLE only).
 * Returns Map<coreId, capacity> where capacity is 0-1024, or null if unavailable.
 */
function readCoreCapacities(onlineCores: number[]): Map<number, number> | null {
	const capacities = new Map<number, number>();
	for (const core of onlineCores) {
		const capPath = `/sys/devices/system/cpu/cpu${core}/cpu_capacity`;
		if (!existsSync(capPath)) return null;
		try {
			const raw = readFileSync(capPath, "utf-8").trim();
			const value = Number(raw);
			if (Number.isNaN(value)) return null;
			capacities.set(core, value);
		} catch {
			return null;
		}
	}
	return capacities.size > 0 ? capacities : null;
}

/** Detect thermal zones from sysfs */
function detectThermalZones(): ThermalZoneInfo[] {
	const base = "/sys/class/thermal";
	if (!existsSync(base)) return [];

	const zones: ThermalZoneInfo[] = [];
	try {
		const dirs = readdirSync(base).filter((d) => d.startsWith("thermal_zone"));
		for (const zone of dirs) {
			const typePath = `${base}/${zone}/type`;
			const tempPath = `${base}/${zone}/temp`;
			if (existsSync(typePath) && existsSync(tempPath)) {
				const type = readFileSync(typePath, "utf-8").trim();
				zones.push({ name: zone, type, path: tempPath });
			}
		}
	} catch {
		// Permission denied or other fs error
	}
	return zones;
}

/**
 * Detect CPU topology and recommend core allocation.
 *
 * Strategy: reserve core 0 for OS housekeeping, use all remaining cores
 * for benchmark isolation.
 *
 * Special cases:
 * - 1 core: housekeeping=0, isolated=[] (no isolation possible)
 * - 2 cores: housekeeping=0, isolated=[1]
 * - N cores: housekeeping=0, isolated=[1..N-1]
 */
export function detectCpuTopology(): CpuTopology {
	// Try Linux sysfs first, fall back to os.cpus()
	const onlineCores = readOnlineCoresFromSysfs() ?? Array.from({ length: cpus().length }, (_, i) => i);
	const totalCores = onlineCores.length;
	const coreCapacities = readCoreCapacities(onlineCores);

	let housekeeping: number;
	let isolated: number[];

	if (coreCapacities) {
		// big.LITTLE: use efficiency core for housekeeping, performance cores for benchmarks
		const capacityValues = [...coreCapacities.values()];
		const maxCap = Math.max(...capacityValues);
		const minCap = Math.min(...capacityValues);

		housekeeping = onlineCores.find((c) => coreCapacities.get(c) === minCap) ?? onlineCores[0] ?? 0;
		isolated = onlineCores.filter((c) => coreCapacities.get(c) === maxCap && c !== housekeeping);
	} else {
		// Homogeneous cores: core 0 = housekeeping, rest = isolated
		housekeeping = onlineCores[0] ?? 0;
		isolated = onlineCores.filter((c) => c !== housekeeping);
	}

	return {
		totalCores,
		onlineCores,
		recommendedIsolated: isolated,
		recommendedHousekeeping: housekeeping,
		thermalZones: detectThermalZones(),
		coreCapacities,
	};
}
