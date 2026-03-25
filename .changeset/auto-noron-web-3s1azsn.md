---
"@noron/web": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- CORS middleware added for all `/api/*` routes; cross-origin requests are rejected with `403`
- Security response headers added globally: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a `Content-Security-Policy`
- Session cookies tightened from `SameSite=Lax` to `SameSite=Strict`
- Invite OAuth flow now uses a random nonce + PKCE code challenge; the raw invite token is no longer passed as the OAuth `state` parameter
- OAuth callback now validates `state` prefix (`upgrade:` / `invite:`); unknown state values return `400` instead of being silently processed
- Auth error messages are now generic (`auth_failed`, "Authentication failed") — no longer reveal whether a user account exists
- `DELETE /api/invites/:id` endpoint added; admin-only, rejects if invite already used
- `GET /api/audit-logs` endpoint added; admin-only, returns last 200 entries
- `audit_logs` table created on `initDb()`; `logAudit()` helper added
- `invites.created_by` column added (schema migration on startup)
- PAT submission now validates length (max 256 chars)
- `pat.added` and `pat.removed` actions are audit-logged
- `invite.created` and `invite.revoked` actions are audit-logged
- Self-update: SHA-256 checksum file (`.sha256`) now required alongside release archive; archive integrity is verified before extraction
- `computeSha256()` helper exported from `crypto.ts`

## BREAKING CHANGES

- `BENCHD_SOCKET` default is now `/run/benchd/benchd.sock`; update environment configuration on existing deployments
- OAuth invite flow state parameter format changed to `invite:<nonce>`; in-flight invite links issued before this release will fail and must be re-generated

Comprehensive security hardening: CSRF/CORS protection, PKCE on all OAuth flows, generic auth error messages, invite revocation, audit logging, and SHA-256 integrity checks for self-updates.
