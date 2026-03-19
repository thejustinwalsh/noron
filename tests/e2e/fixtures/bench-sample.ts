/**
 * Minimal benchmark fixture for e2e testing.
 * Runs a tight fibonacci loop, measures wall-clock time, outputs JSON.
 */

function fib(n: number): number {
	let a = 0;
	let b = 1;
	for (let i = 0; i < n; i++) {
		const t = b;
		b = a + b;
		a = t;
	}
	return a;
}

const ITERATIONS = 100;
const FIB_N = 1000;
const times: number[] = [];

for (let i = 0; i < ITERATIONS; i++) {
	const start = performance.now();
	fib(FIB_N);
	times.push((performance.now() - start) * 1e6); // convert ms → ns
}

times.sort((a, b) => a - b);
const mean = times.reduce((s, t) => s + t, 0) / times.length;

const result = {
	benchmark: `fib-${FIB_N}`,
	iterations: ITERATIONS,
	mean_ns: Math.round(mean),
	min_ns: Math.round(times[0]),
	max_ns: Math.round(times[times.length - 1]),
};

console.log(JSON.stringify(result));
