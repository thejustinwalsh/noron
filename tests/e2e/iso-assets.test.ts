/**
 * Validates that @noron/iso's build produces all assets the ISO build needs.
 * Run after: BUN_TARGET=... turbo run build --filter=@noron/iso...
 *
 * This catches regressions where a new asset is added to the ISO scripts
 * but not to a package's build output.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DIST = join(import.meta.dir, "../../packages/iso/dist");

describe("ISO dist/ assets", () => {
	test("compiled binaries exist", () => {
		expect(existsSync(join(DIST, "benchd/benchd"))).toBe(true);
		expect(existsSync(join(DIST, "bench-exec/bench-exec"))).toBe(true);
		expect(existsSync(join(DIST, "web/bench-web"))).toBe(true);
		expect(existsSync(join(DIST, "setup/bench-setup"))).toBe(true);
		expect(existsSync(join(DIST, "cli/bench"))).toBe(true);
		expect(existsSync(join(DIST, "runner-ctl/runner-ctld"))).toBe(true);
	});

	test("hook binaries exist", () => {
		expect(existsSync(join(DIST, "benchd/hooks/job-started"))).toBe(true);
		expect(existsSync(join(DIST, "benchd/hooks/job-completed"))).toBe(true);
	});

	test("dashboard assets exist", () => {
		expect(existsSync(join(DIST, "dashboard/index.html"))).toBe(true);
	});

	test("runner image assets exist", () => {
		expect(existsSync(join(DIST, "runner-image/Containerfile"))).toBe(true);
		expect(existsSync(join(DIST, "runner-image/start.sh"))).toBe(true);
	});
});
