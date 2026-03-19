import { Hono } from "hono";
import { html } from "hono/html";
import type { Database } from "bun:sqlite";
import { validateInvite } from "../invite";
import { getAuthorizationUrl } from "../github-oauth";

export function inviteRoutes(db: Database): Hono {
	const app = new Hono();

	// User clicks invite link — validates and redirects to GitHub OAuth
	// The OAuth callback comes back to /auth/callback which handles both flows
	app.get("/:token", (c) => {
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

		// Redirect to GitHub OAuth with invite token as state
		const authUrl = getAuthorizationUrl(token);
		return c.redirect(authUrl);
	});

	return app;
}
