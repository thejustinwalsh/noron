---
"@noron/web": patch
---

> Branch: refactor-disk-image-flow
> PR: https://github.com/thejustinwalsh/noron/pull/2

- WebSocket upgrade auth now accepts token from cookie or `Authorization` header in addition to the `?token=` query parameter, using the shared `extractToken` helper

Allows WebSocket clients (e.g. the dashboard in a browser with an existing session cookie) to authenticate without exposing the token in the URL.
