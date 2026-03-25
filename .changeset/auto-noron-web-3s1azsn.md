---
"@noron/web": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

**Security audit and bug fixes**

**Authentication**
- Session cookies upgraded from `SameSite=Lax` to `SameSite=Strict`
- OAuth callback now validates the state prefix (`invite:`, `upgrade:`); unknown state values return 400 instead of being silently processed
- Error messages for failed authentication are now generic and do not reveal whether a GitHub user is registered
- Invite OAuth flow now generates a random nonce + PKCE code challenge/verifier; the raw invite token is no longer passed as the OAuth `state` parameter

**Admin API**
- New `DELETE /api/invites/:id` endpoint to revoke unused invites (admin only); revocation is audit-logged
- New `GET /api/audit-logs` endpoint returning the 200 most recent admin actions (admin only)
- Invite creation now records `created_by` user ID in the database

**Security headers and CORS**
- All responses now include `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a restrictive `Content-Security-Policy`
- Cross-origin requests to `/api/*` are rejected with 403 unless the origin matches `PUBLIC_URL`

**PAT management**
- GitHub PAT input is now capped at 256 characters
- PAT add and remove actions are audit-logged

**Self-update integrity**
- Update check now requires a `.sha256` checksum file alongside each release archive; update is aborted if the file is missing or the hash is malformed
- Self-update workflow verifies the SHA-256 digest of the downloaded archive before extracting
- Release CI publishes `.sha256` checksum files for both x64 and arm64 update archives

**Database**
- Added `created_by` column to `invites` table (auto-migrated)
- Added `audit_logs` table with `idx_audit_logs_created` index (auto-migrated)
- Added `logAudit()` helper in `db.ts`

Comprehensive security hardening pass: CSRF/PKCE for invite flow, generic auth errors, strict CORS and security headers, SHA-256 update verification, audit logging, and reduced container capabilities.
