import { readFileSync } from "node:fs";

const VERSION_FILE = "/var/lib/bench/version";

function readVersion(): string {
	// Env var overrides everything (for development/testing/CI)
	if (process.env.NORON_VERSION) return process.env.NORON_VERSION;

	// Production: read from version file written by bench-updater
	try {
		const fileVersion = readFileSync(VERSION_FILE, "utf-8").trim();
		if (fileVersion) return fileVersion;
	} catch {
		// Version file doesn't exist
	}

	return "dev";
}

/** Current appliance version, read once at startup. */
export const NORON_VERSION = readVersion();
