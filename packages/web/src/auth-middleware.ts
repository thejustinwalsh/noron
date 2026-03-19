import type { Database } from "bun:sqlite";

export interface AuthUser {
	id: string;
	githubLogin: string;
	role: string;
	githubToken: string | null;
	githubScope: string | null;
	githubPat: string | null;
}

/**
 * Look up a user by their bearer token from the device auth flow.
 * Returns null if token is invalid or user not found.
 */
export function getUserByToken(db: Database, token: string): AuthUser | null {
	const row = db
		.query(
			`SELECT u.id, u.github_login, u.role, u.github_token, u.github_scope, u.github_pat
			 FROM users u
			 JOIN device_codes dc ON dc.user_id = u.id
			 WHERE dc.token = ?
			   AND (dc.session_expires_at IS NULL OR dc.session_expires_at > ?)`,
		)
		.get(token, Date.now()) as {
		id: string;
		github_login: string;
		role: string;
		github_token: string | null;
		github_scope: string | null;
		github_pat: string | null;
	} | null;

	if (!row) return null;

	return {
		id: row.id,
		githubLogin: row.github_login,
		role: row.role,
		githubToken: row.github_token,
		githubScope: row.github_scope,
		githubPat: row.github_pat,
	};
}

/**
 * Extract bearer token from Authorization header.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader?.startsWith("Bearer ")) return null;
	return authHeader.slice(7);
}

/**
 * Parse a specific cookie value from a Cookie header string.
 */
export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
	if (!cookieHeader) return null;
	const match = cookieHeader.split(";").find((c) => c.trim().startsWith(`${name}=`));
	if (!match) return null;
	return match.split("=").slice(1).join("=").trim();
}

/**
 * Extract auth token: check bench_session cookie first, then Authorization header as fallback.
 * Cookie is used by the dashboard (browser), Authorization header by CLI/API clients.
 */
export function extractToken(
	cookieHeader: string | undefined,
	authHeader: string | undefined,
): string | null {
	return parseCookie(cookieHeader, "bench_session") ?? extractBearerToken(authHeader);
}
