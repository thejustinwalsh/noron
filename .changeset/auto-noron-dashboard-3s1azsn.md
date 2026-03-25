---
"@noron/dashboard": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Admin panel: active invites now show a Revoke button; revoked invites are immediately reflected in the list
- Audit log panel added to admin dashboard, showing the last 200 entries (timestamp, user, action, details)
- `useInvites` hook exposes `revokeInvite` mutation; `useAuditLogs` hook added

Security audit improvements are now visible in the admin UI with audit trail and invite lifecycle management.
