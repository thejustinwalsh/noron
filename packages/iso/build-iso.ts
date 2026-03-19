// Build the ISO image from collected dist artifacts.
// Delegates to provisioning/iso/build-iso.sh.
// Usage: ARCH=arm64 bun run build:iso
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = resolve(import.meta.dirname, "dist");
const BUILD_ISO_SH = resolve(ROOT, "provisioning/iso/build-iso.sh");

const ARCH = process.env.ARCH ?? "arm64";

const archToLb: Record<string, string> = {
	arm64: "arm64",
	x64: "amd64",
};

const lbArch = archToLb[ARCH];
if (!lbArch) {
	console.error(`Unsupported ARCH=${ARCH}. Use arm64 or x64`);
	process.exit(1);
}

if (!existsSync(resolve(DIST, "benchd/benchd"))) {
	console.error("dist/ not populated. Run `bun run build` first.");
	process.exit(1);
}

console.log(`Building ISO (${ARCH}) from ${DIST}`);
execSync(`bash "${BUILD_ISO_SH}" "${DIST}" "${lbArch}"`, {
	stdio: "inherit",
	cwd: ROOT,
});
