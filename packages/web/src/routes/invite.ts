import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { html } from "hono/html";
import { generateCodeChallenge, generateCodeVerifier, getAuthorizationUrl } from "../github-oauth";
import { validateInvite } from "../invite";

export function inviteRoutes(db: Database): Hono {
	const app = new Hono();

	// User clicks invite link — validates, generates CSRF nonce + PKCE, redirects to GitHub OAuth
	app.get("/:token", async (c) => {
		const token = c.req.param("token");
		const result = validateInvite(db, token);

		if (!result.valid) {
			return c.html(html`
				<!DOCTYPE html>
				<html><body style="font-family:system-ui;max-width:500px;margin:100px auto;text-align:center">
					<h2>This invite link is invalid or has expired.</h2>
					<p>Contact the admin for a new invite link.</p>
				</body></html>
			`);
		}

		// Generate random nonce + PKCE (matches dashboard/device flow pattern)
		const nonce = crypto.randomUUID();
		const now = Date.now();
		const expiresAt = now + 10 * 60 * 1000; // 10 minutes
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);

		// Store nonce → invite token mapping (user_code holds invite token for recovery)
		db.run(
			"INSERT INTO device_codes (code, user_code, created_at, expires_at, code_verifier) VALUES (?, ?, ?, ?, ?)",
			[nonce, token, now, expiresAt, verifier],
		);

		const authUrl = getAuthorizationUrl(`invite:${nonce}`, "read:user", challenge);
		return c.redirect(authUrl);
	});

	return app;
}
