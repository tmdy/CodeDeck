# Technical design

## Authentication contract

Extend `SiteBalanceSession` and its draft with `auth_kind: "access_token" | "session_cookie"`. Missing legacy values normalize to `access_token`.

Keep the encrypted credential in the existing `access_token` field for storage compatibility during this stage. `auth_kind` exclusively controls its interpretation.

## Request resolution

Add a shared management-auth resolver that produces one transport only:

- `access_token`: `Authorization: Bearer <credential>` plus user-ID headers where required.
- `session_cookie`: `Cookie: session=<credential>` (or a preserved wrapped cookie value) plus user-ID headers where required.

Balance and check-in may probe endpoints and user IDs, but they must not probe across authentication kinds.

## Learned paths and errors

Ignore and invalidate learned paths whose authorization/cookie modes conflict with the current account kind. Map 401/403 errors using the explicit kind. Diagnostics record only enums and redacted previews.

## Compatibility

Existing IDs, Profile bindings, and encrypted config remain stable. Changing `auth_kind` updates account state and clears the bound balance/check-in capability caches.

## Deferred work

Browser-session capture is a separate second-stage task after cookie transport is stable.
