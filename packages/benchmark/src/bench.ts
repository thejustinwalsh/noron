// Variance-sensitive benchmarks for testing runner stability.
// These are intentionally chosen to amplify noise from CPU contention,
// thermal throttling, and scheduling jitter — exactly what our appliance eliminates.

import { run, bench, group } from "mitata";

// --- CPU-bound: tight loop that's sensitive to frequency scaling & contention ---
group("cpu", () => {
	bench("fibonacci(30)", () => {
		let a = 0;
		let b = 1;
		for (let i = 0; i < 30; i++) [a, b] = [b, a + b];
		return b;
	});

	bench("sha256(1KB)", async () => {
		const data = new Uint8Array(1024);
		await crypto.subtle.digest("SHA-256", data);
	});

	bench("json-parse-stringify", () => {
		const obj = {
			users: Array.from({ length: 50 }, (_, i) => ({
				id: i,
				name: `user_${i}`,
				tags: ["a", "b", "c"],
				nested: { x: i * 2, y: i * 3 },
			})),
		};
		JSON.parse(JSON.stringify(obj));
	});
});

// --- Allocation-heavy: GC pressure shows up as variance ---
group("alloc", () => {
	bench("object-churn", () => {
		const arr = [];
		for (let i = 0; i < 1000; i++) arr.push({ i, s: String(i) });
		return arr.length;
	});

	bench("map-set-delete", () => {
		const m = new Map<number, string>();
		for (let i = 0; i < 500; i++) m.set(i, String(i));
		for (let i = 0; i < 500; i++) m.delete(i);
		return m.size;
	});

	bench("array-sort-1k", () => {
		const arr = Array.from({ length: 1000 }, () => Math.random());
		arr.sort((a, b) => a - b);
		return arr[0];
	});
});

// --- Timer-sensitive: measures scheduling jitter directly ---
group("timing", () => {
	bench("date-now-1k", () => {
		let t = 0;
		for (let i = 0; i < 1000; i++) t = Date.now();
		return t;
	});

	bench("performance-now-1k", () => {
		let t = 0;
		for (let i = 0; i < 1000; i++) t = performance.now();
		return t;
	});
});

// Run and write JSON results
const result = await run({ format: "json", silent: true });

interface BenchStats {
	samples: number[];
	avg: number;
	min: number;
	max: number;
	p25: number;
	p50: number;
	p75: number;
	p99: number;
	p999: number;
	ticks: number;
	counters?: Record<string, number>;
}

interface BenchResult {
	alias: string;
	group: number;
	runs: { stats: BenchStats }[];
}

interface BenchOutput {
	layout: { name: string | null }[];
	benchmarks: BenchResult[];
}

const output = result as unknown as BenchOutput;

// Extract compact results with samples for variance analysis
const results = output.benchmarks.map((b) => {
	const s = b.runs[0].stats;
	return {
		name: b.alias,
		group: output.layout[b.group]?.name ?? "ungrouped",
		samples: s.samples,
		avg: s.avg,
		min: s.min,
		max: s.max,
		p25: s.p25,
		p50: s.p50,
		p75: s.p75,
		p99: s.p99,
		ticks: s.ticks,
		...(s.counters ? { counters: s.counters } : {}),
	};
});

const outPath = process.env.BENCH_OUTPUT ?? "results.json";
const meta = {
	runner: process.env.BENCH_RUNNER ?? "unknown",
	runIndex: Number.parseInt(process.env.BENCH_RUN_INDEX ?? "0"),
	timestamp: new Date().toISOString(),
	platform: process.platform,
	arch: process.arch,
};

await Bun.write(outPath, JSON.stringify({ meta, results }, null, 2));
console.log(`Wrote ${results.length} benchmarks to ${outPath}`);
