// Collect dist/ outputs from all sibling packages into packages/iso/dist/
// Turbo guarantees all deps are built before this runs (dependsOn: ["^build"]).
// Walks packages/*/dist/ and copies whatever exists. No hardcoded list.
import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const PACKAGES = resolve(ROOT, "packages");
const DIST = resolve(import.meta.dirname, "dist");

// Walk all sibling packages — copy any that have a dist/ dir
for (const pkg of readdirSync(PACKAGES)) {
	if (pkg === "iso") continue;

	const pkgDist = join(PACKAGES, pkg, "dist");
	if (!existsSync(pkgDist)) continue;

	const destDir = join(DIST, pkg);
	mkdirSync(destDir, { recursive: true });
	cpSync(pkgDist, destDir, { recursive: true });

	const files = readdirSync(pkgDist, { recursive: true });
	console.log(`  ${pkg}/ (${files.length} files)`);
}

// Runner image assets (not a workspace package)
const runnerAssets = ["Containerfile", "start.sh", "runner-ctl.sh"];
const runnerDest = join(DIST, "runner-image");
mkdirSync(runnerDest, { recursive: true });
for (const asset of runnerAssets) {
	const src = join(ROOT, "runner-image", asset);
	if (!existsSync(src)) {
		console.error(`  MISSING: runner-image/${asset}`);
		process.exit(1);
	}
	cpSync(src, join(runnerDest, asset));
}
console.log(`  runner-image/ (${runnerAssets.length} files)`);

console.log(`\nCollected to ${DIST}`);
