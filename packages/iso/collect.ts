// Collect dist/ outputs from all sibling packages into packages/iso/dist/
// Turbo guarantees all deps are built before this runs (dependsOn: ["^build"]).
// Walks packages/*/dist/ and copies whatever exists. No hardcoded list.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
const runnerAssets = ["Containerfile", "start.sh", "bench-runner-update.sh"];
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

// bench-updater script
const updaterSrc = join(ROOT, "provisioning", "bench-updater.sh");
if (existsSync(updaterSrc)) {
	cpSync(updaterSrc, join(DIST, "bench-updater.sh"));
	console.log("  bench-updater.sh");
}

// Systemd service templates (benchd + runner-ctld are static, bench-web has config)
const systemdDest = join(DIST, "systemd");
mkdirSync(systemdDest, { recursive: true });
const systemdServices = ["benchd.service", "runner-ctld.service"];
for (const svc of systemdServices) {
	const src = join(ROOT, "provisioning", "systemd", svc);
	if (existsSync(src)) {
		cpSync(src, join(systemdDest, svc));
	}
}
console.log(`  systemd/ (${systemdServices.length} files)`);

// Version file — written from @noron/iso package.json so bench-updater
// can update /var/lib/bench/version on apply.
const pkgJson = JSON.parse(readFileSync(join(import.meta.dirname, "package.json"), "utf-8"));
writeFileSync(join(DIST, "version"), pkgJson.version);
console.log(`  version (${pkgJson.version})`);

console.log(`\nCollected to ${DIST}`);
