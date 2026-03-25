---
"@noron/web": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

**Auth and OAuth:**
- Session cookies changed from `SameSite=Lax` to `SameSite=Strict`
- OAuth callback now validates the state prefix (`upgrade:` or `invite:`) and rejects unknown states with 400
- Invite flow now generates a random nonce + PKCE (code verifier/challenge) stored in `device_codes`; invite token is no longer passed as OAuth state, closing an OAuth state injection vector
- Auth error messages genericized: no longer reveal whether a user/account exists (e.g., "Authentication failed" instead of "Not registered")
- Error redirect code changed from `not_registered` to `auth_failed`

**Security headers and CORS:**
- Security headers added to all responses: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy`
- Cross-origin requests to `/api/*` rejected with 403 when `Origin` doesn't match `PUBLIC_URL`
- PAT submission input length capped at 256 characters

**Audit logging:**
- New `audit_logs` table (with index on `created_at`) and `logAudit()` helper
- Events recorded: `invite.created`, `invite.revoked`, `pat.added`, `pat.removed`
- New admin endpoint `GET /api/audit-logs` returns the last 200 entries
- `invites` table gains a `created_by` column (automatic migration)

**Admin UI:**
- Revoke button on active invites (calls new `DELETE /api/invites/:id`)
- New Audit Log panel in AdminPanel showing timestamp, user, action, and details

**Self-update integrity:**
- Update check now requires a `.sha256` checksum file alongside the release archive; skips update if the file is missing or malformed
- Self-update workflow verifies the SHA-256 digest of the downloaded archive before extracting

Security audit addressing CSRF, OAuth state injection, information disclosure, missing HTTP security headers, and unverified update archive integrity.
