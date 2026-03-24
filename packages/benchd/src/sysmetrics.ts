import { readFileSync, statfsSync } from "node:fs";

/**
 * Lightweight system metrics reader.
 * Reads /proc/stat and /proc/meminfo — single small file reads that
 * execute on the housekeeping core and never touch isolated benchmark cores.
 */

interface CpuTick {
	user: number;
	nice: number;
	system: number;
	idle: number;
	iowait: number;
	irq: number;
	softirq: number;
	steal: number;
}

function parseCpuLine(line: string): CpuTick {
	const parts = line.split(/\s+/);
	return {
		user: Number(parts[1]),
		nice: Number(parts[2]),
		system: Number(parts[3]),
		idle: Number(parts[4]),
		iowait: Number(parts[5]) || 0,
		irq: Number(parts[6]) || 0,
		softirq: Number(parts[7]) || 0,
		steal: Number(parts[8]) || 0,
	};
}

function totalTicks(t: CpuTick): number {
	return t.user + t.nice + t.system + t.idle + t.iowait + t.irq + t.softirq + t.steal;
}

function activeTicks(t: CpuTick): number {
	return totalTicks(t) - t.idle - t.iowait;
}

export class SysMetrics {
	private prevCpu: CpuTick | null = null;
	private cpuPercent = 0;

	/** Read current CPU usage as 0–100%. Requires two calls to produce a delta. */
	readCpu(): number {
		try {
			const stat = readFileSync("/proc/stat", "utf-8");
			const line = stat.slice(0, stat.indexOf("\n"));
			const cur = parseCpuLine(line);

			if (this.prevCpu) {
				const dTotal = totalTicks(cur) - totalTicks(this.prevCpu);
				const dActive = activeTicks(cur) - activeTicks(this.prevCpu);
				this.cpuPercent = dTotal > 0 ? Math.round((dActive / dTotal) * 1000) / 10 : 0;
			}
			this.prevCpu = cur;
		} catch {
			// Not on Linux — return 0
		}
		return this.cpuPercent;
	}

	/** Read disk usage for the root filesystem. */
	readDisk(): { usedGb: number; totalGb: number; percent: number } {
		try {
			const st = statfsSync("/");
			const totalBytes = st.blocks * st.bsize;
			const availBytes = st.bavail * st.bsize;
			const usedBytes = totalBytes - availBytes;
			const totalGb = Math.round((totalBytes / 1024 ** 3) * 10) / 10;
			const usedGb = Math.round((usedBytes / 1024 ** 3) * 10) / 10;
			const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
			return { usedGb, totalGb, percent };
		} catch {
			return { usedGb: 0, totalGb: 0, percent: 0 };
		}
	}

	/** Read current memory usage from /proc/meminfo. */
	readMemory(): { usedMb: number; totalMb: number; percent: number } {
		try {
			const info = readFileSync("/proc/meminfo", "utf-8");
			let totalKb = 0;
			let availableKb = 0;

			for (const line of info.split("\n")) {
				if (line.startsWith("MemTotal:")) {
					totalKb = Number(line.split(/\s+/)[1]);
				} else if (line.startsWith("MemAvailable:")) {
					availableKb = Number(line.split(/\s+/)[1]);
				}
				if (totalKb && availableKb) break;
			}

			const totalMb = Math.round(totalKb / 1024);
			const usedMb = Math.round((totalKb - availableKb) / 1024);
			const percent = totalKb > 0 ? Math.round(((totalKb - availableKb) / totalKb) * 1000) / 10 : 0;
			return { usedMb, totalMb, percent };
		} catch {
			return { usedMb: 0, totalMb: 0, percent: 0 };
		}
	}
}
