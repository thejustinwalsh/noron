import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "bench");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Credentials {
	githubToken: string;
	githubLogin: string;
	expiresAt?: number;
}

export interface Config {
	serverUrl?: string;
	socketPath?: string;
}

function ensureDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

export function loadCredentials(): Credentials | null {
	if (!existsSync(CREDENTIALS_FILE)) return null;
	try {
		const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
		if (data.expiresAt && Date.now() > data.expiresAt) return null;
		return data as Credentials;
	} catch {
		return null;
	}
}

export function saveCredentials(creds: Credentials): void {
	ensureDir();
	writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, "\t"), {
		mode: 0o600,
	});
}

export function loadConfig(): Config {
	if (!existsSync(CONFIG_FILE)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Config;
	} catch {
		return {};
	}
}

export function saveConfig(config: Config): void {
	ensureDir();
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, "\t"));
}
