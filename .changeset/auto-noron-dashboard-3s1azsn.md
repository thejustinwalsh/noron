---
"@noron/dashboard": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Admin panel now shows a Revoke button next to each active invite; used invites cannot be revoked
- New Audit Log panel in the admin panel displays the last 200 admin actions with timestamp, user, action type, and details

These changes give administrators visibility into invite and credential activity and the ability to invalidate outstanding invites.
