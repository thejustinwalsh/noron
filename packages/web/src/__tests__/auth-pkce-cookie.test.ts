import { describe, expect, test } from "bun:test";
import { extractBearerToken, extractToken, parseCookie } from "../auth-middleware";
import { generateCodeChallenge, generateCodeVerifier, getAuthorizationUrl } from "../github-oauth";

describe("PKCE", () => {
	test("generateCodeVerifier returns string of correct length", () => {
		const verifier = generateCodeVerifier();
		expect(verifier.length).toBe(64);
		// Only unreserved characters per RFC 7636
		expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
	});

	test("generateCodeVerifier respects custom length", () => {
		const short = generateCodeVerifier(43);
		expect(short.length).toBe(43);
		const long = generateCodeVerifier(128);
		expect(long.length).toBe(128);
	});

	test("generateCodeChallenge produces valid base64url", async () => {
		const verifier = "test-verifier-string";
		const challenge = await generateCodeChallenge(verifier);
		// Base64url: no +, /, or = characters
		expect(challenge).not.toMatch(/[+/=]/);
		// Should be non-empty
		expect(challenge.length).toBeGreaterThan(0);
	});

	test("generateCodeChallenge is deterministic for same input", async () => {
		const verifier = "deterministic-test";
		const c1 = await generateCodeChallenge(verifier);
		const c2 = await generateCodeChallenge(verifier);
		expect(c1).toBe(c2);
	});

	test("generateCodeChallenge differs for different inputs", async () => {
		const c1 = await generateCodeChallenge("verifier-one");
		const c2 = await generateCodeChallenge("verifier-two");
		expect(c1).not.toBe(c2);
	});

	test("getAuthorizationUrl includes code_challenge when provided", () => {
		const url = getAuthorizationUrl("test-state", "read:user", "test-challenge");
		const params = new URL(url).searchParams;
		expect(params.get("code_challenge")).toBe("test-challenge");
		expect(params.get("code_challenge_method")).toBe("S256");
	});

	test("getAuthorizationUrl omits code_challenge when not provided", () => {
		const url = getAuthorizationUrl("test-state");
		const params = new URL(url).searchParams;
		expect(params.has("code_challenge")).toBe(false);
		expect(params.has("code_challenge_method")).toBe(false);
	});
});

describe("Cookie-based auth extraction", () => {
	test("parseCookie extracts bench_session from cookie header", () => {
		const cookie = "bench_session=abc-123; other=value";
		expect(parseCookie(cookie, "bench_session")).toBe("abc-123");
	});

	test("parseCookie returns null when cookie is missing", () => {
		const cookie = "other=value; something=else";
		expect(parseCookie(cookie, "bench_session")).toBeNull();
	});

	test("parseCookie returns null for undefined header", () => {
		expect(parseCookie(undefined, "bench_session")).toBeNull();
	});

	test("parseCookie handles cookie with = in value", () => {
		const cookie = "bench_session=abc=def; other=value";
		expect(parseCookie(cookie, "bench_session")).toBe("abc=def");
	});

	test("extractBearerToken extracts from Authorization header", () => {
		expect(extractBearerToken("Bearer my-token-123")).toBe("my-token-123");
	});

	test("extractBearerToken returns null for missing header", () => {
		expect(extractBearerToken(undefined)).toBeNull();
	});

	test("extractBearerToken returns null for non-Bearer header", () => {
		expect(extractBearerToken("Basic abc123")).toBeNull();
	});

	test("extractToken prefers cookie over Authorization header", () => {
		const token = extractToken("bench_session=cookie-token", "Bearer header-token");
		expect(token).toBe("cookie-token");
	});

	test("extractToken falls back to Authorization header when no cookie", () => {
		const token = extractToken("other=value", "Bearer header-token");
		expect(token).toBe("header-token");
	});

	test("extractToken falls back to Authorization header when cookie header is undefined", () => {
		const token = extractToken(undefined, "Bearer header-token");
		expect(token).toBe("header-token");
	});

	test("extractToken returns null when neither cookie nor header present", () => {
		const token = extractToken(undefined, undefined);
		expect(token).toBeNull();
	});
});
