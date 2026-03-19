const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";

import * as z from "@zod/mini";
import { DEFAULT_WEB_PORT } from "@noron/shared";

const GitHubTokenResponse = z.object({
	access_token: z.optional(z.string()),
	error: z.optional(z.string()),
});

const GitHubUser = z.object({
	id: z.number(),
	login: z.string(),
});

function getBaseUrl(): string {
	return process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? DEFAULT_WEB_PORT}`;
}

/**
 * Generate a cryptographically random code verifier (RFC 7636 Section 4.1).
 * 43-128 characters from the unreserved character set [A-Z a-z 0-9 -._~].
 */
export function generateCodeVerifier(length = 64): string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, (b) => unreserved[b % unreserved.length]).join("");
}

/**
 * Derive a code challenge from a verifier using S256 (RFC 7636 Section 4.2).
 * Returns the BASE64URL-encoded SHA-256 hash of the verifier.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	);
	// Base64url encode (no padding)
	const base64 = btoa(String.fromCharCode(...digest));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getAuthorizationUrl(
	state: string,
	scope = "read:user",
	codeChallenge?: string,
): string {
	const params = new URLSearchParams({
		client_id: GITHUB_CLIENT_ID,
		redirect_uri: `${getBaseUrl()}/auth/callback`,
		scope,
		state,
	});
	if (codeChallenge) {
		params.set("code_challenge", codeChallenge);
		params.set("code_challenge_method", "S256");
	}
	return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string, codeVerifier?: string): Promise<string> {
	const body: Record<string, string> = {
		client_id: GITHUB_CLIENT_ID,
		client_secret: GITHUB_CLIENT_SECRET,
		code,
	};
	if (codeVerifier) {
		body.code_verifier = codeVerifier;
	}

	const res = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify(body),
	});

	const parsed = z.safeParse(GitHubTokenResponse, await res.json());
	if (!parsed.success || !parsed.data.access_token) {
		const errMsg = parsed.success ? parsed.data.error : "Malformed token response";
		throw new Error(errMsg ?? "Failed to exchange code for token");
	}
	return parsed.data.access_token;
}

export async function getGithubUser(
	token: string,
): Promise<{ id: number; login: string }> {
	const res = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
		},
	});

	if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);
	const user = z.parse(GitHubUser, await res.json());
	return { id: user.id, login: user.login };
}
