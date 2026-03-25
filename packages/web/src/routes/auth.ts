import type { Database } from "bun:sqlite";
import { DEFAULT_WEB_PORT } from "@noron/shared";
import * as z from "@zod/mini";
import { type Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { encryptToken } from "../crypto";
import {
	exchangeCode,
	generateCodeChallenge,
	generateCodeVerifier,
	getAuthorizationUrl,
	getGithubUser,
} from "../github-oauth";
import { markInviteUsed, validateInvite } from "../invite";

/** Session duration: 30 days (matches cookie Max-Age) */
const SESSION_DURATION_MS = 30 * 24 * 3600_000;

function isSecureContext(): boolean {
	const publicUrl = process.env.PUBLIC_URL ?? "";
	return publicUrl.startsWith("https://");
}

function setSessionCookie(c: Context, token: string): void {
	const secure = isSecureContext() ? "; Secure" : "";
	c.header(
		"Set-Cookie",
		`bench_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}${secure}`,
	);
}

function clearSessionCookie(c: Context): void {
	const secure = isSecureContext() ? "; Secure" : "";
	c.header("Set-Cookie", `bench_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

const DevicePollBody = z.object({
	deviceCode: z.string(),
});

export function authRoutes(db: Database): Hono {
	const app = new Hono();

	// Initiate device auth flow (called by CLI)
	app.post("/device", (c) => {
		const deviceCode = crypto.randomUUID();
		// Cryptographically random user code — ambiguous chars (0/O, 1/I/L) excluded
		const bytes = crypto.getRandomValues(new Uint8Array(8));
		const userCode = Array.from(bytes, (b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join("");
		const now = Date.now();
		const expiresAt = now + 10 * 60 * 1000; // 10 minutes

		db.run(
			"INSERT INTO device_codes (code, user_code, created_at, expires_at) VALUES (?, ?, ?, ?)",
			[deviceCode, userCode, now, expiresAt],
		);

		const baseUrl =
			process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? DEFAULT_WEB_PORT}`;
		return c.json({
			deviceCode,
			userCode,
			verificationUri: `${baseUrl}/auth/verify?code=${userCode}`,
		});
	});

	// Poll for device auth completion (called by CLI)
	app.post("/device/poll", async (c) => {
		const parsed = z.safeParse(DevicePollBody, await c.req.json());
		if (!parsed.success) return c.json({ error: "Invalid request body" }, 400);
		const body = parsed.data;
		const row = db.query("SELECT * FROM device_codes WHERE code = ?").get(body.deviceCode) as {
			code: string;
			expires_at: number;
			user_id: string | null;
			token: string | null;
		} | null;

		if (!row) return c.json({ status: "not_found" }, 404);
		if (Date.now() > row.expires_at) return c.json({ status: "expired" });
		if (!row.token) return c.json({ status: "pending" });

		const user = row.user_id
			? (db.query("SELECT github_login, role FROM users WHERE id = ?").get(row.user_id) as {
					github_login: string;
					role: string;
				} | null)
			: null;

		// Clean up used device code
		db.run("DELETE FROM device_codes WHERE code = ?", [body.deviceCode]);

		return c.json({
			status: "complete",
			token: row.token,
			login: user?.github_login,
			role: user?.role,
		});
	});

	// User visits this page to approve the device code — redirects to GitHub OAuth
	app.get("/verify", async (c) => {
		const userCode = c.req.query("code");
		if (!userCode) return c.text("Missing code", 400);

		// Check that the device code exists and is valid
		const row = db
			.query("SELECT code, expires_at FROM device_codes WHERE user_code = ? AND token IS NULL")
			.get(userCode) as { code: string; expires_at: number } | null;

		if (!row || Date.now() > row.expires_at) {
			return c.html(html`
				<!DOCTYPE html>
				<html><body style="font-family:system-ui;max-width:400px;margin:100px auto;text-align:center">
					<h2>Code expired or invalid</h2>
					<p>Please try again from your terminal.</p>
				</body></html>
			`);
		}

		// PKCE: generate verifier/challenge and store verifier keyed by state
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);
		db.run("UPDATE device_codes SET code_verifier = ? WHERE code = ?", [verifier, row.code]);

		// Show the code and redirect to GitHub OAuth with user_code as state
		return c.html(html`
			<!DOCTYPE html>
			<html><body style="font-family:system-ui;max-width:400px;margin:100px auto;text-align:center">
				<h2>Verify Device</h2>
				<p>Confirm this code matches your terminal:</p>
				<pre style="font-size:28px;letter-spacing:4px;background:#111;color:#0f0;padding:16px;border-radius:8px">${userCode}</pre>
				<p>Click below to sign in with GitHub and authorize this device.</p>
				<a href="${getAuthorizationUrl(`device:${userCode}`, "read:user", challenge)}"
				   style="display:inline-block;padding:12px 24px;font-size:16px;cursor:pointer;margin-top:16px;background:#24292e;color:white;text-decoration:none;border-radius:6px">
					Sign in with GitHub
				</a>
			</body></html>
		`);
	});

	// Dashboard login — redirect to GitHub OAuth
	app.get("/login", async (c) => {
		const nonce = crypto.randomUUID();
		const now = Date.now();
		const expiresAt = now + 10 * 60 * 1000; // 10 minutes

		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);

		db.run(
			"INSERT INTO device_codes (code, user_code, created_at, expires_at, code_verifier) VALUES (?, ?, ?, ?, ?)",
			[nonce, `dash-${nonce.slice(0, 8)}`, now, expiresAt, verifier],
		);
		return c.redirect(getAuthorizationUrl(`dashboard:${nonce}`, "read:user", challenge));
	});

	// Upgrade: re-authenticate with expanded scope (read:user repo)
	app.get("/upgrade", async (c) => {
		const nonce = crypto.randomUUID();
		const now = Date.now();
		const expiresAt = now + 10 * 60 * 1000; // 10 minutes

		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);

		db.run(
			"INSERT INTO device_codes (code, user_code, created_at, expires_at, code_verifier) VALUES (?, ?, ?, ?, ?)",
			[nonce, `upg-${nonce.slice(0, 8)}`, now, expiresAt, verifier],
		);
		return c.redirect(getAuthorizationUrl(`upgrade:${nonce}`, "read:user repo", challenge));
	});

	// Unified GitHub OAuth callback — dispatches on state prefix
	app.get("/callback", async (c) => {
		const code = c.req.query("code");
		const state = c.req.query("state");

		if (!code || !state) {
			return c.text("Missing code or state", 400);
		}

		try {
			if (state.startsWith("device:")) {
				return await handleDeviceCallback(db, c, code, state);
			}
			if (state.startsWith("dashboard:")) {
				return await handleDashboardCallback(db, c, code, state);
			}
			if (state.startsWith("upgrade:")) {
				return await handleUpgradeCallback(db, c, code, state);
			}
			if (state.startsWith("invite:")) {
				return await handleInviteCallback(db, c, code, state);
			}
			return c.text("Invalid authentication state", 400);
		} catch (err) {
			console.error("OAuth callback error:", err);
			const message = err instanceof Error ? err.message : String(err);
			c.status(500);
			return c.html(html`
				<!DOCTYPE html>
				<html><body style="font-family:system-ui;max-width:500px;margin:100px auto;text-align:center">
					<h2>Authentication Error</h2>
					<p>${message}</p>
					<p style="color:#999;font-size:13px">Check that GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set correctly.</p>
				</body></html>
			`);
		}
	});

	// Logout — clear session cookie
	app.post("/logout", (c) => {
		clearSessionCookie(c);
		return c.json({ ok: true });
	});

	return app;
}

async function handleDeviceCallback(db: Database, c: Context, code: string, state: string) {
	const userCode = state.slice("device:".length);

	const row = db
		.query(
			"SELECT code, expires_at, code_verifier FROM device_codes WHERE user_code = ? AND token IS NULL",
		)
		.get(userCode) as { code: string; expires_at: number; code_verifier: string | null } | null;

	if (!row || Date.now() > row.expires_at) {
		return c.html(html`
			<!DOCTYPE html>
			<html><body style="font-family:system-ui;max-width:400px;margin:100px auto;text-align:center">
				<h2>Code expired or invalid</h2>
				<p>Please try again from your terminal.</p>
			</body></html>
		`);
	}

	const accessToken = await exchangeCode(code, row.code_verifier ?? undefined);
	const ghUser = await getGithubUser(accessToken);

	const user = db.query("SELECT id FROM users WHERE github_id = ?").get(ghUser.id) as {
		id: string;
	} | null;

	if (!user) {
		return c.html(html`
			<!DOCTYPE html>
			<html><body style="font-family:system-ui;max-width:400px;margin:100px auto;text-align:center">
				<h2>Authentication failed</h2>
				<p>Unable to complete sign-in. Please contact an admin if you need access.</p>
			</body></html>
		`);
	}

	const token = crypto.randomUUID();
	const sessionExpiresAt = Date.now() + SESSION_DURATION_MS;
	db.run("UPDATE device_codes SET token = ?, user_id = ?, session_expires_at = ? WHERE code = ?", [
		token,
		user.id,
		sessionExpiresAt,
		row.code,
	]);
	const encryptedToken = await encryptToken(accessToken);
	db.run("UPDATE users SET last_seen_at = ?, github_token = ? WHERE id = ?", [
		Date.now(),
		encryptedToken,
		user.id,
	]);

	return c.html(html`
		<!DOCTYPE html>
		<html><body style="font-family:system-ui;max-width:400px;margin:100px auto;text-align:center">
			<h2>Device authorized</h2>
			<p>Welcome back, ${ghUser.login}! You can close this window.</p>
			<p>Your terminal will connect shortly.</p>
		</body></html>
	`);
}

async function handleDashboardCallback(db: Database, c: Context, code: string, state: string) {
	const nonce = state.slice("dashboard:".length);

	const row = db
		.query(
			"SELECT code, expires_at, code_verifier FROM device_codes WHERE code = ? AND token IS NULL",
		)
		.get(nonce) as { code: string; expires_at: number; code_verifier: string | null } | null;

	if (!row || Date.now() > row.expires_at) {
		return c.redirect("/dashboard/?error=expired");
	}

	const accessToken = await exchangeCode(code, row.code_verifier ?? undefined);
	const ghUser = await getGithubUser(accessToken);

	const user = db.query("SELECT id FROM users WHERE github_id = ?").get(ghUser.id) as {
		id: string;
	} | null;

	if (!user) {
		// Clean up
		db.run("DELETE FROM device_codes WHERE code = ?", [nonce]);
		return c.redirect("/dashboard/?error=auth_failed");
	}

	const token = crypto.randomUUID();
	const sessionExpiresAt = Date.now() + SESSION_DURATION_MS;
	db.run("UPDATE device_codes SET token = ?, user_id = ?, session_expires_at = ? WHERE code = ?", [
		token,
		user.id,
		sessionExpiresAt,
		nonce,
	]);
	const encryptedToken = await encryptToken(accessToken);
	db.run("UPDATE users SET last_seen_at = ?, github_token = ? WHERE id = ?", [
		Date.now(),
		encryptedToken,
		user.id,
	]);

	// Set HttpOnly session cookie instead of passing token in URL
	setSessionCookie(c, token);
	return c.redirect("/dashboard/");
}

async function handleUpgradeCallback(db: Database, c: Context, code: string, state: string) {
	const nonce = state.slice("upgrade:".length);

	const row = db
		.query(
			"SELECT code, expires_at, code_verifier FROM device_codes WHERE code = ? AND token IS NULL",
		)
		.get(nonce) as { code: string; expires_at: number; code_verifier: string | null } | null;

	if (!row || Date.now() > row.expires_at) {
		return c.redirect("/dashboard/?error=expired");
	}

	const accessToken = await exchangeCode(code, row.code_verifier ?? undefined);
	const ghUser = await getGithubUser(accessToken);

	const user = db.query("SELECT id FROM users WHERE github_id = ?").get(ghUser.id) as {
		id: string;
	} | null;

	if (!user) {
		db.run("DELETE FROM device_codes WHERE code = ?", [nonce]);
		return c.redirect("/dashboard/?error=auth_failed");
	}

	// Update token and scope to the expanded 'read:user repo'
	const encryptedToken = await encryptToken(accessToken);
	db.run(
		"UPDATE users SET last_seen_at = ?, github_token = ?, github_scope = 'read:user repo' WHERE id = ?",
		[Date.now(), encryptedToken, user.id],
	);

	// Reuse the nonce as a session token so user stays logged in
	const token = crypto.randomUUID();
	const sessionExpiresAt = Date.now() + SESSION_DURATION_MS;
	db.run("UPDATE device_codes SET token = ?, user_id = ?, session_expires_at = ? WHERE code = ?", [
		token,
		user.id,
		sessionExpiresAt,
		nonce,
	]);

	// Set HttpOnly session cookie instead of passing token in URL
	setSessionCookie(c, token);
	return c.redirect("/dashboard/?upgraded=1");
}

async function handleInviteCallback(db: Database, c: Context, code: string, state: string) {
	const nonce = state.slice("invite:".length);

	// Look up nonce in device_codes — user_code holds the invite token
	const row = db
		.query(
			"SELECT code, user_code, expires_at, code_verifier FROM device_codes WHERE code = ? AND token IS NULL",
		)
		.get(nonce) as {
		code: string;
		user_code: string;
		expires_at: number;
		code_verifier: string | null;
	} | null;

	if (!row || Date.now() > row.expires_at) {
		return c.text("Authentication failed", 400);
	}

	const inviteToken = row.user_code;
	const invite = validateInvite(db, inviteToken);
	if (!invite.valid) {
		db.run("DELETE FROM device_codes WHERE code = ?", [nonce]);
		return c.text("Invite is invalid or expired", 400);
	}

	const accessToken = await exchangeCode(code, row.code_verifier ?? undefined);
	const ghUser = await getGithubUser(accessToken);

	const userCount = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };
	const role = userCount.count === 0 ? "admin" : "user";

	const userId = crypto.randomUUID();
	const encryptedToken = await encryptToken(accessToken);
	db.run(
		`INSERT INTO users (id, github_id, github_login, role, github_token, github_scope, created_at, last_seen_at)
		 VALUES (?, ?, ?, ?, ?, 'read:user', ?, ?)
		 ON CONFLICT(github_id) DO UPDATE SET
			github_login = excluded.github_login,
			github_token = excluded.github_token,
			github_scope = excluded.github_scope,
			last_seen_at = excluded.last_seen_at`,
		[userId, ghUser.id, ghUser.login, role, encryptedToken, Date.now(), Date.now()],
	);

	markInviteUsed(db, invite.id, userId);

	// Get the actual user ID (may have been an upsert)
	const actualUser = db.query("SELECT id FROM users WHERE github_id = ?").get(ghUser.id) as {
		id: string;
	};

	// Generate a dashboard token so the user is logged in immediately
	const token = crypto.randomUUID();
	const now = Date.now();
	const sessionExpiresAt = now + SESSION_DURATION_MS;
	db.run(
		"INSERT INTO device_codes (code, user_code, created_at, expires_at, token, user_id, session_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[
			crypto.randomUUID(),
			`inv-${crypto.randomUUID().slice(0, 8)}`,
			now,
			now + 30 * 24 * 3600_000,
			token,
			actualUser.id,
			sessionExpiresAt,
		],
	);

	// Set HttpOnly session cookie instead of passing token in URL
	setSessionCookie(c, token);
	return c.redirect("/dashboard/");
}
