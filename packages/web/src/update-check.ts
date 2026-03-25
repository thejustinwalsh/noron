import type { Database } from "bun:sqlite";
import type { BenchdConfig } from "@noron/shared";
import { startSelfUpdateWorkflow } from "./workflows/self-update";

const NORON_VERSION = process.env.NORON_VERSION ?? "dev";

/** Compare two semver strings. Returns >0 if a > b, <0 if a < b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/** Extract version from a release tag like "v1.2.3" */
export function parseReleaseTag(tag: string): string | null {
	const match = tag.match(/^v(.+)/);
	return match?.[1] ?? null;
}

interface GitHubRelease {
	tag_name: string;
	assets: { name: string; browser_download_url: string; size: number }[];
}

/** Check GitHub Releases for a newer version. Starts update workflow if found. */
export async function checkForUpdate(db: Database, config: BenchdConfig): Promise<void> {
	if (!config.updateRepo) return;
	if (NORON_VERSION === "dev") {
		console.log("[update-check] Skipping — running dev build");
		return;
	}

	// Don't start a new update if one is already in progress
	const pending = db
		.query(
			"SELECT id FROM updates WHERE state IN ('pending', 'downloading', 'applying', 'verifying') LIMIT 1",
		)
		.get();
	if (pending) return;

	try {
		const res = await fetch(`https://api.github.com/repos/${config.updateRepo}/releases/latest`, {
			headers: { Accept: "application/vnd.github+json" },
		});

		if (!res.ok) {
			if (res.status === 404) return; // No releases yet
			console.error(`[update-check] GitHub API ${res.status}`);
			return;
		}

		const release = (await res.json()) as GitHubRelease;
		const remoteVersion = parseReleaseTag(release.tag_name);
		if (!remoteVersion) {
			console.error(`[update-check] Cannot parse tag: ${release.tag_name}`);
			return;
		}

		if (compareSemver(remoteVersion, NORON_VERSION) <= 0) return;

		// Find the update archive for our architecture
		const arch = process.arch === "arm64" ? "arm64" : "x64";
		const assetName = `noron-update-linux-${arch}.tar.gz`;
		const asset = release.assets.find((a) => a.name === assetName);
		if (!asset) {
			console.error(`[update-check] Release ${remoteVersion} missing asset: ${assetName}`);
			return;
		}

		// Require SHA-256 checksum file alongside the archive
		const checksumAssetName = `${assetName}.sha256`;
		const checksumAsset = release.assets.find((a) => a.name === checksumAssetName);
		if (!checksumAsset) {
			console.error(
				`[update-check] Release ${remoteVersion} missing checksum: ${checksumAssetName}`,
			);
			return;
		}

		let expectedHash: string;
		try {
			const hashRes = await fetch(checksumAsset.browser_download_url);
			if (!hashRes.ok) throw new Error(`HTTP ${hashRes.status}`);
			// Format: "<hash>  <filename>\n" or just "<hash>\n"
			const text = await hashRes.text();
			expectedHash = text.trim().split(/\s+/)[0];
			if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
				throw new Error(`Invalid hash format: ${expectedHash}`);
			}
		} catch (err) {
			console.error(`[update-check] Failed to fetch checksum for ${remoteVersion}: ${err}`);
			return;
		}

		console.log(`[update-check] Update available: ${NORON_VERSION} → ${remoteVersion}`);

		// Record and start the update workflow
		const updateId = crypto.randomUUID();
		db.run(
			"INSERT INTO updates (id, version, state, download_url, started_at) VALUES (?, ?, 'pending', ?, ?)",
			[updateId, remoteVersion, asset.browser_download_url, Date.now()],
		);

		await startSelfUpdateWorkflow({
			updateId,
			version: remoteVersion,
			downloadUrl: asset.browser_download_url,
			expectedSize: asset.size,
			expectedHash,
		});
	} catch (err) {
		console.error("[update-check] Failed:", err);
	}
}
