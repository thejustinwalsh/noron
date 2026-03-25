---
"@noron/dashboard": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

**Security audit and bug fixes**

- Added "Revoke" button for active invites in the Admin Panel; revoked invites are immediately invalidated
- Added Audit Log panel in the Admin Panel showing a timestamped table of admin actions (invite creation/revocation, PAT changes) with the acting user's GitHub login
- Added `revokeInvite` mutation to `useInvites()` hook (`DELETE /api/invites/:id`)
- Added `useAuditLogs()` hook for fetching audit log entries from `/api/audit-logs`

Admin panel gains invite revocation and a read-only audit log view for tracking admin actions.
