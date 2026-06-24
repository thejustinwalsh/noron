export function isPublicSignupEnabled(env: Record<string, string | undefined>): boolean {
	return env.NORON_PUBLIC_SIGNUP === "1" || env.NORON_PUBLIC_SIGNUP === "true";
}
