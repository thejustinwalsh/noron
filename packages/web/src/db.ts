import { Database } from "bun:sqlite";
import { DEFAULT_WEB_PORT } from "@noron/shared";

export function initDb(path: string): Database {
	const db = new Database(path, { create: true });
	db.exec("PRAGMA journal_mode=WAL");
	db.exec("PRAGMA wal_autocheckpoint=100");
	db.exec("PRAGMA foreign_keys=ON");

	db.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			github_id INTEGER UNIQUE NOT NULL,
			github_login TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			created_at INTEGER NOT NULL,
			last_seen_at INTEGER
		)
	`);

	// Migrate existing databases
	try {
		db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE users ADD COLUMN github_token TEXT");
	} catch {
		// Column already exists
	}

	db.exec(`
		CREATE TABLE IF NOT EXISTS invites (
			id TEXT PRIMARY KEY,
			token TEXT UNIQUE NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			used_at INTEGER,
			used_by TEXT REFERENCES users(id)
		)
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS runners (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			owner_id TEXT NOT NULL REFERENCES users(id),
			repo TEXT NOT NULL,
			registered_at INTEGER NOT NULL,
			last_heartbeat INTEGER,
			status TEXT DEFAULT 'offline'
		)
	`);

	// Migration: enforce one runner per repo at the DB level
	db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_runners_repo ON runners(repo)");

	// Migration: add workflow_run_id for tracking provisioning workflows
	try {
		db.exec("ALTER TABLE runners ADD COLUMN workflow_run_id TEXT");
	} catch {
		// Column already exists
	}

	// Migration: add callback_token for secure container → web callback
	try {
		db.exec("ALTER TABLE runners ADD COLUMN callback_token TEXT");
	} catch {
		// Column already exists
	}

	// Migration: track OAuth scope granted by each user
	try {
		db.exec("ALTER TABLE users ADD COLUMN github_scope TEXT DEFAULT 'read:user'");
	} catch {
		// Column already exists
	}

	// Migration: optional fine-grained PAT
	try {
		db.exec("ALTER TABLE users ADD COLUMN github_pat TEXT");
	} catch {
		// Column already exists
	}

	// Migration: human-readable error details for runners
	try {
		db.exec("ALTER TABLE runners ADD COLUMN status_message TEXT");
	} catch {
		// Column already exists
	}

	// One-time fixup: existing users who already have a github_token were granted 'read:user repo'
	db.run(
		"UPDATE users SET github_scope = 'read:user repo' WHERE github_token IS NOT NULL AND github_scope = 'read:user'",
	);

	db.exec(`
		CREATE TABLE IF NOT EXISTS device_codes (
			code TEXT PRIMARY KEY,
			user_code TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			user_id TEXT REFERENCES users(id),
			token TEXT,
			code_verifier TEXT
		)
	`);

	// Migration: add PKCE code_verifier column
	try {
		db.exec("ALTER TABLE device_codes ADD COLUMN code_verifier TEXT");
	} catch {
		// Column already exists
	}

	// Migration: add session expiry for session tokens (30 days)
	try {
		db.exec("ALTER TABLE device_codes ADD COLUMN session_expires_at INTEGER");
	} catch {
		// Column already exists
	}

	// Clean up expired sessions on startup
	db.run(
		"DELETE FROM device_codes WHERE token IS NOT NULL AND session_expires_at IS NOT NULL AND session_expires_at < ?",
		[Date.now()],
	);

	db.exec(`
		CREATE TABLE IF NOT EXISTS updates (
			id TEXT PRIMARY KEY,
			version TEXT NOT NULL,
			state TEXT NOT NULL DEFAULT 'pending',
			download_url TEXT,
			started_at INTEGER,
			completed_at INTEGER,
			error TEXT
		)
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS violations (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			runner_id TEXT REFERENCES runners(id),
			job_id TEXT,
			run_id TEXT,
			reason TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)
	`);

	// Migration: per-repo job timeout override (admin-configurable)
	try {
		db.exec("ALTER TABLE runners ADD COLUMN job_timeout_ms INTEGER");
	} catch {
		// Column already exists
	}

	// Migration: runner disable tracking
	try {
		db.exec("ALTER TABLE runners ADD COLUMN disabled_at INTEGER");
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE runners ADD COLUMN disabled_reason TEXT");
	} catch {
		// Column already exists
	}

	// Generate a bootstrap invite on first run so the first user can register
	const inviteCount = db.query("SELECT COUNT(*) as count FROM invites").get() as { count: number };
	if (inviteCount.count === 0) {
		const token = crypto.randomUUID();
		const now = Date.now();
		const expiresAt = now + 7 * 24 * 3600_000; // 7 days for bootstrap
		db.run("INSERT INTO invites (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)", [
			crypto.randomUUID(),
			token,
			now,
			expiresAt,
		]);
		const baseUrl =
			process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? DEFAULT_WEB_PORT}`;
		console.log(
			`\n  Bootstrap invite: ${baseUrl}/invite/${token}\n  Use this to register the first admin account.\n`,
		);
	}

	return db;
}
