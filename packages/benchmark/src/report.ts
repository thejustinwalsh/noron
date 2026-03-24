// Compare benchmark results across multiple runs and runners.
// Generates a self-contained HTML report with variance analysis.
//
// Usage: bun run src/report.ts results/*.json --out report.html

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

interface Meta {
	runner: string;
	runIndex: number;
	timestamp: string;
}

interface BenchEntry {
	name: string;
	group: string;
	samples: number[];
	avg: number;
	min: number;
	max: number;
	p25: number;
	p50: number;
	p75: number;
	p99: number;
	counters?: Record<string, number>;
}

interface RunFile {
	meta: Meta;
	results: BenchEntry[];
}

interface PerfStatData {
	ipc: number | null;
	contextSwitches: number;
	cpuMigrations: number;
	branchMissRate: number | null;
	l1MissRate: number | null;
	isolationHealthy: boolean;
}

// Parse args
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : "report.html";
const perfStatIdx = args.indexOf("--perf-stat");
const perfStatDir = perfStatIdx >= 0 ? args[perfStatIdx + 1] : "";
const inputArgs = args.filter(
	(_, i) => i !== outIdx && i !== outIdx + 1 && i !== perfStatIdx && i !== perfStatIdx + 1,
);

// Collect input files (args can be files or dirs)
const files: string[] = [];
for (const arg of inputArgs) {
	try {
		const entries = readdirSync(arg);
		for (const e of entries) if (e.endsWith(".json")) files.push(resolve(arg, e));
	} catch {
		files.push(resolve(arg));
	}
}

if (files.length === 0) {
	console.error("No result files found");
	process.exit(1);
}

// Load all runs (exclude perf-stat files — they have a different schema)
const runs: RunFile[] = files
	.filter((f) => !f.includes("perf-stat"))
	.map((f) => JSON.parse(readFileSync(f, "utf-8")));

// Load perf stat sidecar files if available
// Look for perf-stat.json next to result files, or in --perf-stat dir
const perfStatFiles: PerfStatData[] = [];
if (perfStatDir) {
	try {
		const entries = readdirSync(perfStatDir);
		for (const e of entries) {
			if (e.endsWith(".json") && e.includes("perf-stat")) {
				perfStatFiles.push(JSON.parse(readFileSync(resolve(perfStatDir, e), "utf-8")));
			}
		}
	} catch {
		// perf stat dir not found or not readable — skip
	}
} else {
	// Auto-detect: look for perf-stat.json next to each result file
	for (const f of files) {
		const sidecar = resolve(dirname(f), "perf-stat.json");
		if (existsSync(sidecar)) {
			try {
				perfStatFiles.push(JSON.parse(readFileSync(sidecar, "utf-8")));
			} catch {
				// skip malformed
			}
		}
	}
}
const hasPerfStat = perfStatFiles.length > 0;

// Group by runner
const byRunner = new Map<string, RunFile[]>();
for (const run of runs) {
	const key = run.meta.runner;
	if (!byRunner.has(key)) byRunner.set(key, []);
	byRunner.get(key)?.push(run);
}

// Compute stats across runs for each benchmark per runner
function cv(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	if (mean === 0) return 0;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
	return (Math.sqrt(variance) / mean) * 100;
}

function iqrCV(samples: number[]): number {
	if (samples.length < 4) return cv(samples);
	const sorted = [...samples].sort((a, b) => a - b);
	const q1 = sorted[Math.floor(sorted.length * 0.25)];
	const q3 = sorted[Math.floor(sorted.length * 0.75)];
	const iqr = q3 - q1;
	const filtered = sorted.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
	return cv(filtered);
}

interface BenchComparison {
	name: string;
	group: string;
	runners: Map<
		string,
		{
			avgOfAvgs: number;
			runToRunCV: number;
			withinRunCV: number;
			runs: number;
			p99Spread: number;
		}
	>;
}

// Get all unique benchmark names
const benchNames = [...new Set(runs.flatMap((r) => r.results.map((b) => b.name)))];

const comparisons: BenchComparison[] = benchNames.map((name) => {
	const runners = new Map<string, unknown>();
	for (const [runner, runnerRuns] of byRunner) {
		const entries = runnerRuns
			.map((r) => r.results.find((b) => b.name === name))
			.filter((b): b is BenchEntry => b != null);

		if (entries.length === 0) continue;

		const avgs = entries.map((e) => e.avg);
		const p99s = entries.map((e) => e.p99);
		const withinCVs = entries.map((e) => iqrCV(e.samples));

		// Aggregate counters across runs (avg of each counter value)
		const counterKeys = [...new Set(entries.flatMap((e) => Object.keys(e.counters ?? {})))];
		const counters: Record<string, { avg: number; cv: number }> = {};
		for (const key of counterKeys) {
			const vals = entries.map((e) => e.counters?.[key]).filter((v): v is number => v != null);
			if (vals.length > 0) {
				counters[key] = {
					avg: vals.reduce((a, b) => a + b, 0) / vals.length,
					cv: cv(vals),
				};
			}
		}

		runners.set(runner, {
			avgOfAvgs: avgs.reduce((a, b) => a + b, 0) / avgs.length,
			runToRunCV: cv(avgs),
			withinRunCV: withinCVs.reduce((a, b) => a + b, 0) / withinCVs.length,
			runs: entries.length,
			p99Spread: Math.max(...p99s) / Math.min(...p99s),
			counters,
		});
	}
	const group = runs.flatMap((r) => r.results).find((b) => b.name === name)?.group ?? "";
	return { name, group, runners };
});

// Generate HTML report
function fmtNs(ns: number): string {
	if (ns < 1000) return `${ns.toFixed(2)} ns`;
	if (ns < 1_000_000) return `${(ns / 1000).toFixed(2)} µs`;
	return `${(ns / 1_000_000).toFixed(2)} ms`;
}

function cvClass(pct: number): string {
	if (pct < 1) return "excellent";
	if (pct < 3) return "good";
	if (pct < 5) return "fair";
	return "poor";
}

function cvBadge(pct: number): string {
	const cls = cvClass(pct);
	return `<span class="badge ${cls}">${pct.toFixed(2)}%</span>`;
}

const runnerNames = [...byRunner.keys()].sort();
const groups = [...new Set(comparisons.map((c) => c.group))];

const tableRows = groups
	.map((g) => {
		const groupBenches = comparisons.filter((c) => c.group === g);
		const header = `<tr class="group-header"><td colspan="${1 + runnerNames.length * 3}">${g}</td></tr>`;
		const rows = groupBenches
			.map((c) => {
				const cells = runnerNames
					.map((r) => {
						const d = c.runners.get(r);
						if (!d) return "<td>-</td><td>-</td><td>-</td>";
						return `<td>${fmtNs(d.avgOfAvgs)}</td><td>${cvBadge(d.runToRunCV)}</td><td>${cvBadge(d.withinRunCV)}</td>`;
					})
					.join("");
				return `<tr><td class="bench-name">${c.name}</td>${cells}</tr>`;
			})
			.join("\n");
		return `${header}\n${rows}`;
	})
	.join("\n");

const runnerHeaders = runnerNames
	.map(
		(r) =>
			`<th colspan="3">${r} <span class="run-count">(${byRunner.get(r)?.length} runs)</span></th>`,
	)
	.join("");
const subHeaders = runnerNames
	.map(() => "<th>avg</th><th>run-to-run CV</th><th>within-run CV</th>")
	.join("");

// Summary stats
const summaryRows = runnerNames
	.map((r) => {
		const allRunToRun = comparisons
			.map((c) => c.runners.get(r)?.runToRunCV)
			.filter((v): v is number => v != null);
		const allWithin = comparisons
			.map((c) => c.runners.get(r)?.withinRunCV)
			.filter((v): v is number => v != null);
		const medianR2R =
			[...allRunToRun].sort((a, b) => a - b)[Math.floor(allRunToRun.length / 2)] ?? 0;
		const medianWithin =
			[...allWithin].sort((a, b) => a - b)[Math.floor(allWithin.length / 2)] ?? 0;
		const maxR2R = Math.max(...allRunToRun, 0);
		return `<tr><td>${r}</td><td>${byRunner.get(r)?.length}</td><td>${cvBadge(medianR2R)}</td><td>${cvBadge(maxR2R)}</td><td>${cvBadge(medianWithin)}</td></tr>`;
	})
	.join("\n");

// Build per-benchmark chart data for JS
const chartData = JSON.stringify(
	comparisons.map((c) => ({
		name: c.name,
		group: c.group,
		runners: Object.fromEntries(
			[...c.runners.entries()].map(([r, d]) => [
				r,
				{
					avg: d.avgOfAvgs,
					runToRunCV: d.runToRunCV,
					withinRunCV: d.withinRunCV,
					counters: d.counters,
				},
			]),
		),
	})),
);

// Collect all counter names across all results
const allCounterKeys = [
	...new Set(
		comparisons.flatMap((c) =>
			[...c.runners.values()].flatMap((d) => Object.keys(d.counters ?? {})),
		),
	),
];
const hasCounters = allCounterKeys.length > 0;

// Build counters table if available
const countersSection = !hasCounters
	? ""
	: (() => {
			const cHeaders = runnerNames
				.map((r) => `<th colspan="${allCounterKeys.length}">${r}</th>`)
				.join("");
			const cSubHeaders = runnerNames
				.map(() => allCounterKeys.map((k) => `<th>${k}</th>`).join(""))
				.join("");
			const cRows = comparisons
				.map((c) => {
					const cells = runnerNames
						.map((r) => {
							const d = c.runners.get(r);
							if (!d) return allCounterKeys.map(() => "<td>-</td>").join("");
							return allCounterKeys
								.map((k) => {
									const ct = d.counters?.[k];
									if (!ct) return "<td>-</td>";
									return `<td>${ct.avg.toFixed(1)} ${cvBadge(ct.cv)}</td>`;
								})
								.join("");
						})
						.join("");
					return `<tr><td class="bench-name">${c.name}</td>${cells}</tr>`;
				})
				.join("\n");
			return `
<h2>CPU Counters</h2>
<p class="subtitle">Hardware performance counters (avg value + CV across runs). Requires @mitata/counters and perf_event_paranoid &lt;= 2.</p>
<table>
<thead>
<tr><th rowspan="2">Benchmark</th>${cHeaders}</tr>
<tr>${cSubHeaders}</tr>
</thead>
<tbody>${cRows}</tbody>
</table>`;
		})();

// Build isolation health section from perf stat data
const isolationSection = !hasPerfStat
	? ""
	: (() => {
			const healthBadge = (healthy: boolean) =>
				healthy
					? '<span class="badge excellent">HEALTHY</span>'
					: '<span class="badge poor">WARNING</span>';

			const fmtVal = (v: number | null, suffix = "") =>
				v != null ? `${v.toFixed(2)}${suffix}` : "-";

			const rows = perfStatFiles
				.map(
					(p, i) =>
						`<tr><td>Run ${i + 1}</td><td>${healthBadge(p.isolationHealthy)}</td>` +
						`<td>${p.contextSwitches}</td><td>${p.cpuMigrations}</td>` +
						`<td>${fmtVal(p.ipc)}</td><td>${fmtVal(p.branchMissRate, "%")}</td>` +
						`<td>${fmtVal(p.l1MissRate, "%")}</td></tr>`,
				)
				.join("\n");

			return `
<h2>Isolation Health</h2>
<p class="subtitle">Hardware counters from perf stat. Context switches and CPU migrations should be 0 on isolated cores.</p>
<table>
<thead>
<tr><th>Run</th><th>Status</th><th>Context Switches</th><th>CPU Migrations</th><th>IPC</th><th>Branch Miss Rate</th><th>L1 Miss Rate</th></tr>
</thead>
<tbody>${rows}</tbody>
</table>`;
		})();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Benchmark Stability Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #f0f6fc; }
  .subtitle { color: #8b949e; margin-bottom: 24px; font-size: 0.9rem; }
  h2 { font-size: 1.1rem; margin: 24px 0 12px; color: #f0f6fc; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #21262d; }
  th { background: #161b22; color: #8b949e; font-weight: 600; position: sticky; top: 0; }
  tr:hover { background: #161b22; }
  .group-header td { background: #1c2128; font-weight: 600; color: #58a6ff; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; }
  .bench-name { font-family: ui-monospace, monospace; color: #f0f6fc; }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
  .excellent { background: #0d4429; color: #3fb950; }
  .good { background: #1a3a2a; color: #56d364; }
  .fair { background: #3d2e00; color: #d29922; }
  .poor { background: #4a1a1a; color: #f85149; }
  .run-count { font-weight: 400; color: #6e7681; }
  .summary { margin-bottom: 24px; }
  .legend { display: flex; gap: 16px; margin: 16px 0; font-size: 0.8rem; }
  .legend span { display: flex; align-items: center; gap: 4px; }
  .chart-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin: 24px 0; }
  .chart-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
  .chart-card h3 { font-size: 0.8rem; font-family: ui-monospace, monospace; color: #f0f6fc; margin-bottom: 8px; }
  .chart-card .group-label { font-size: 0.7rem; color: #8b949e; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 0.75rem; }
  .bar-label { min-width: 80px; color: #8b949e; text-align: right; }
  .bar-track { flex: 1; height: 20px; background: #21262d; border-radius: 4px; position: relative; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; font-size: 0.7rem; font-weight: 600; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #21262d; color: #6e7681; font-size: 0.75rem; }
</style>
</head>
<body>
<h1>Benchmark Stability Report</h1>
<p class="subtitle">Comparing run-to-run variance across runners. Lower CV = more stable.</p>

<div class="legend">
  <span><span class="badge excellent">< 1%</span> Excellent</span>
  <span><span class="badge good">1-3%</span> Good</span>
  <span><span class="badge fair">3-5%</span> Fair</span>
  <span><span class="badge poor">> 5%</span> Poor</span>
</div>

<h2>Summary</h2>
<table class="summary">
<thead><tr><th>Runner</th><th>Runs</th><th>Median Run-to-Run CV</th><th>Worst Run-to-Run CV</th><th>Median Within-Run CV</th></tr></thead>
<tbody>${summaryRows}</tbody>
</table>

<h2>Variance by Benchmark</h2>
<div class="chart-container" id="charts"></div>

${isolationSection}

${countersSection}

<h2>Detailed Results</h2>
<table>
<thead>
<tr><th rowspan="2">Benchmark</th>${runnerHeaders}</tr>
<tr>${subHeaders}</tr>
</thead>
<tbody>${tableRows}</tbody>
</table>

<footer>
Generated ${new Date().toISOString()} &middot; ${files.length} result files &middot; ${runnerNames.length} runners
</footer>

<script>
const data = ${chartData};
const runners = ${JSON.stringify(runnerNames)};
const colors = { 'github': '#58a6ff', 'noron': '#3fb950', 'unknown': '#8b949e' };

function getColor(name) {
  for (const [key, color] of Object.entries(colors)) {
    if (name.toLowerCase().includes(key)) return color;
  }
  return '#8b949e';
}

function cvColor(pct) {
  if (pct < 1) return '#3fb950';
  if (pct < 3) return '#56d364';
  if (pct < 5) return '#d29922';
  return '#f85149';
}

const container = document.getElementById('charts');
const maxCV = Math.max(...data.flatMap(d => Object.values(d.runners).map(r => r.runToRunCV)), 1);

for (const bench of data) {
  const card = document.createElement('div');
  card.className = 'chart-card';
  card.innerHTML = '<span class="group-label">' + bench.group + '</span><h3>' + bench.name + '</h3>';

  for (const runner of runners) {
    const d = bench.runners[runner];
    if (!d) continue;
    const pct = Math.min((d.runToRunCV / Math.max(maxCV, 0.1)) * 100, 100);
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML =
      '<span class="bar-label">' + runner + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(pct, 8) +
      '%;background:' + cvColor(d.runToRunCV) + '">' + d.runToRunCV.toFixed(2) + '%</div></div>';
    card.appendChild(row);
  }
  container.appendChild(card);
}
</script>
</body>
</html>`;

await Bun.write(outPath, html);
console.log(`Report written to ${outPath}`);
