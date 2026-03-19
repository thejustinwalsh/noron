/**
 * Encryption at rest for GitHub tokens stored in SQLite.
 *
 * Uses AES-256-GCM via Web Crypto API. Ciphertext format (base64-encoded):
 *   [12-byte IV][ciphertext + GCM auth tag]
 *
 * Key source (in order):
 *   1. BENCH_ENCRYPTION_KEY env var (64-char hex string = 32 bytes)
 *   2. /etc/benchd/encryption.key file
 *   3. Auto-generated on first use and written to /etc/benchd/encryption.key (mode 0o600)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const KEY_FILE_PATH = "/etc/benchd/encryption.key";
const IV_LENGTH = 12; // 96-bit IV for AES-GCM

let _key: CryptoKey | null = null;

/** Load or generate the encryption key (lazy, once). */
async function getKey(): Promise<CryptoKey> {
	if (_key) return _key;

	let rawHex: string | undefined;

	// 1. Check env var
	rawHex = process.env.BENCH_ENCRYPTION_KEY;

	// 2. Check key file
	if (!rawHex) {
		try {
			rawHex = readFileSync(KEY_FILE_PATH, "utf-8").trim();
		} catch {
			// File doesn't exist or unreadable — will generate below
		}
	}

	// 3. Generate and persist
	if (!rawHex) {
		const keyBytes = crypto.getRandomValues(new Uint8Array(32));
		rawHex = Buffer.from(keyBytes).toString("hex");
		try {
			mkdirSync("/etc/benchd", { recursive: true });
			writeFileSync(KEY_FILE_PATH, rawHex + "\n", { mode: 0o600 });
			console.log(`Generated encryption key and wrote to ${KEY_FILE_PATH}`);
		} catch (err) {
			console.warn(
				`Could not write encryption key to ${KEY_FILE_PATH}: ${err}. ` +
					`Set BENCH_ENCRYPTION_KEY env var or ensure /etc/benchd is writable.`,
			);
		}
	}

	if (!rawHex || rawHex.length !== 64) {
		throw new Error(
			"BENCH_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
				`Got ${rawHex?.length ?? 0} characters.`,
		);
	}

	const keyBuffer = hexToBytes(rawHex);
	_key = await crypto.subtle.importKey(
		"raw",
		keyBuffer.buffer as ArrayBuffer,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);

	return _key;
}

/** Encrypt a plaintext token. Returns base64-encoded [IV + ciphertext]. */
export async function encryptToken(plaintext: string): Promise<string> {
	const key = await getKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoded = new TextEncoder().encode(plaintext);

	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

	const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), IV_LENGTH);

	return Buffer.from(combined).toString("base64");
}

/** Decrypt a base64-encoded [IV + ciphertext] string. Returns null if value is null. */
export async function decryptToken(value: string | null): Promise<string | null> {
	if (!value) return null;

	const key = await getKey();
	const combined = Buffer.from(value, "base64");

	if (combined.length < IV_LENGTH + 1) {
		throw new Error("Ciphertext too short to contain IV + data");
	}

	const iv = combined.subarray(0, IV_LENGTH);
	const ciphertext = combined.subarray(IV_LENGTH);

	const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

	return new TextDecoder().decode(plaintext);
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

/** Reset the cached key — for testing only. */
export function _resetKeyForTesting(): void {
	_key = null;
}
