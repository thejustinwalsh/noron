import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for tmpfs cleanup between benchmark runs.
 * Uses a real temp directory to simulate the tmpfs mount point.
 */
describe("tmpfs cleanup between runs", () => {
	let tmpfsDir: string;

	beforeEach(() => {
		tmpfsDir = mkdtempSync(join(tmpdir(), "bench-tmpfs-test-"));
	});

	afterEach(() => {
		try {
			rmSync(tmpfsDir, { recursive: true, force: true });
		} catch {}
	});

	function cleanupTmpfs(dir: string): number {
		try {
			if (!existsSync(dir)) return 0;
			const entries = readdirSync(dir);
			for (const entry of entries) {
				try {
					rmSync(join(dir, entry), { recursive: true, force: true });
				} catch {
					// best-effort
				}
			}
			return entries.length;
		} catch {
			return 0;
		}
	}

	test("removes files from tmpfs directory", () => {
		writeFileSync(join(tmpfsDir, "output.json"), '{"results": [1, 2, 3]}');
		writeFileSync(join(tmpfsDir, "bench.log"), "benchmark log data");

		const cleaned = cleanupTmpfs(tmpfsDir);
		expect(cleaned).toBe(2);
		expect(readdirSync(tmpfsDir)).toHaveLength(0);
	});

	test("removes nested directories recursively", () => {
		const nested = join(tmpfsDir, "subdir", "deep");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "data.bin"), "secret benchmark data");

		const cleaned = cleanupTmpfs(tmpfsDir);
		expect(cleaned).toBe(1);
		expect(readdirSync(tmpfsDir)).toHaveLength(0);
	});

	test("preserves the tmpfs directory itself", () => {
		writeFileSync(join(tmpfsDir, "file.txt"), "data");

		cleanupTmpfs(tmpfsDir);
		expect(existsSync(tmpfsDir)).toBe(true);
		expect(readdirSync(tmpfsDir)).toHaveLength(0);
	});

	test("handles empty tmpfs gracefully", () => {
		const cleaned = cleanupTmpfs(tmpfsDir);
		expect(cleaned).toBe(0);
		expect(existsSync(tmpfsDir)).toBe(true);
	});

	test("handles non-existent tmpfs gracefully", () => {
		const cleaned = cleanupTmpfs("/nonexistent/path/bench-tmpfs");
		expect(cleaned).toBe(0);
	});

	test("cleans per-session subdirectories with mixed ownership files", () => {
		// Simulates the per-session pattern: {tmpfs}/{sessionId}/perf-stat.tsv
		const session1 = join(tmpfsDir, "aaaa-bbbb-cccc");
		const session2 = join(tmpfsDir, "dddd-eeee-ffff");
		mkdirSync(session1);
		mkdirSync(session2);
		writeFileSync(join(session1, "perf-stat.tsv"), "perf data");
		writeFileSync(join(session1, "perf-stat.json"), '{"ipc": 1.5}');
		writeFileSync(join(session2, "perf-stat.tsv"), "perf data 2");
		writeFileSync(join(session2, "output.json"), '{"results": []}');

		const cleaned = cleanupTmpfs(tmpfsDir);
		expect(cleaned).toBe(2);
		expect(readdirSync(tmpfsDir)).toHaveLength(0);
	});
});
