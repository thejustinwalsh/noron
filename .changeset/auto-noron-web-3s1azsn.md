---
"@noron/web": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

Authentication hardening:
- Invite OAuth flow now uses a random nonce + PKCE code challenge; the invite token is no longer passed directly as OAuth `state`, eliminating CSRF and state-fixation risks
- OAuth callback rejects unknown `state` prefixes with `400` instead of falling through to invite handling
- Session cookies changed from `SameSite=Lax` to `SameSite=Strict`
- Auth error messages genericized — login failure and "not registered" paths now return `auth_failed` to avoid user enumeration

HTTP security:
- CORS enforcement added for all `/api/*` routes; cross-origin requests are rejected with `403`
- Security headers added to all responses: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy`

Audit logging:
- New `audit_logs` database table with index on `created_at`
- `logAudit()` helper records admin actions; currently logs `invite.created`, `invite.revoked`, `pat.added`, and `pat.removed`
- `invites` table gains a `created_by` column tracking which user generated each invite

Admin API additions:
- `DELETE /api/invites/:id` — admins can revoke unused invites
- `GET /api/audit-logs` — returns the last 200 audit log entries (admin only)

Dashboard additions:
- Revoke button on active invites in the Admin Panel
- New Audit Log panel showing time, user, action, and details

Self-update integrity:
- `update-check` now requires a `.sha256` checksum file alongside each release archive; update is aborted if the file is missing or malformed
- `self-update` workflow verifies SHA-256 of downloaded archive before extraction
- `computeSha256` utility added to `crypto.ts`

Input validation:
- PAT submissions rejected if the token exceeds 256 characters

## BREAKING CHANGES

The invite OAuth flow now requires PKCE and a `device_codes` nonce; any in-flight invite links from before this release will be invalidated and users will need to request a new invite link.

This release completes a comprehensive security audit addressing CSRF, user enumeration, missing integrity checks, and privilege escalation vectors across the web service.
