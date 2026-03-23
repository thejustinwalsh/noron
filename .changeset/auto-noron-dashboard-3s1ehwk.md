---
"@noron/dashboard": minor
---

> Branch: fix-runner-update
> PR: https://github.com/thejustinwalsh/noron/pull/3

## Changes

- Auth loading state: `useAuth` now exposes a `loading` flag; the app renders a blank header while the session is being validated, eliminating the flash of unauthenticated UI on reload
- Global auth guard: unauthenticated users are redirected to a login prompt at the app level; individual page components no longer repeat auth checks
- `useWebSocket`, `useUserInfo`, `useWorkflowCounts` now accept an `enabled` boolean; all three are gated on `authenticated` so no requests are made before login
- WebSocket reconnect loop is halted when `enabled` becomes false (e.g., on logout), preventing stale connections
- `useWorkflowCounts` polling interval disabled when `enabled` is false
- Lint fix: long `useWebSocket(authenticated)` destructure split across two lines

Fixed auth-related rendering and request gating so the dashboard only fetches data and opens WebSocket connections when the user is authenticated.
