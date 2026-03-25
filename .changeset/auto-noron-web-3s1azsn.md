---
"@noron/web": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- CORS middleware added: API endpoints reject cross-origin requests; allowed origin is derived from `PUBLIC_URL` env var or localhost
- Security headers added to all responses: `X-Frame-Options: DENY`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 0`, `Referrer-Policy`
- Session cookies hardened from `SameSite=Lax` to `SameSite=Strict`
- Invite OAuth flow now uses a random nonce as OAuth state and a PKCE code challenge; the raw invite token is no longer passed as OAuth state, closing a CSRF vector
- OAuth callback rejects any state value that doesn't match a known prefix (`device:`, `dashboard:`, `upgrade:`, `invite:`), preventing unrecognized state from being silently accepted
- Auth error messages are now generic — failure pages and redirects no longer reveal whether a GitHub account is registered
- Admin invite creation records `created_by` user on the invite row
- New `DELETE /api/invites/:id` endpoint allows admins to revoke unused invites
- New `GET /api/audit-logs` endpoint returns the last 200 admin actions (invite create/revoke, PAT add/remove) with user attribution
- `audit_logs` table added via migration; `logAudit()` helper records admin actions
- PAT input validated to max 256 characters before touching GitHub API or storage
- Self-update downloads now require a matching `.sha256` checksum file published alongside the release archive; download is blocked if the file is missing or the hash doesn't match
- Added `computeSha256()` utility to `crypto.ts` for SHA-256 hashing
- Comprehensive security hardening tests added covering `computeSha256`, audit logging, invite revocation, DB schema migrations, security headers, CORS, OAuth state dispatch, and PAT length validation

## BREAKING CHANGES

- Existing deployments will have the `audit_logs` table and `invites.created_by` column added automatically on first startup via migrations — no manual action required
- OAuth redirect error query param changed from `error=not_registered` to `error=auth_failed`; any client-side handling of the old value should be updated

These changes address multiple security findings: CSRF in OAuth invite flow, overly broad CORS policy, missing security headers, user enumeration via error messages, unverified self-update downloads, and lack of admin audit trail.
