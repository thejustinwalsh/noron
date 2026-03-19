import type { Database } from "bun:sqlite";
import { TOKEN_EXPIRY_HOURS } from "@noron/shared";

export function generateInvite(
	db: Database,
	expiryHours = TOKEN_EXPIRY_HOURS,
): string {
	const id = crypto.randomUUID();
	const token = crypto.randomUUID();
	const now = Date.now();
	const expiresAt = now + expiryHours * 3600_000;

	db.run(
		"INSERT INTO invites (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)",
		[id, token, now, expiresAt],
	);

	return token;
}

export function validateInvite(
	db: Database,
	token: string,
): { valid: true; id: string } | { valid: false; reason: string } {
	const row = db
		.query("SELECT id, expires_at, used_at FROM invites WHERE token = ?")
		.get(token) as { id: string; expires_at: number; used_at: number | null } | null;

	if (!row) return { valid: false, reason: "not_found" };
	if (row.used_at) return { valid: false, reason: "already_used" };
	if (Date.now() > row.expires_at) return { valid: false, reason: "expired" };
	return { valid: true, id: row.id };
}

export function markInviteUsed(
	db: Database,
	inviteId: string,
	userId: string,
): void {
	db.run("UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?", [
		Date.now(),
		userId,
		inviteId,
	]);
}
